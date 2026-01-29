// Mission Control Beads Dashboard
// Styled to match GT Mission Control for unified monitoring experience
package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/steveyegge/beads/internal/beads"
	"github.com/steveyegge/beads/internal/rpc"
	"github.com/steveyegge/beads/internal/types"
)

//go:embed web
var webFiles embed.FS

var (
	port       = flag.Int("port", 8082, "Port for web server (default 8082 to not conflict with GT dashboard)")
	host       = flag.String("host", "localhost", "Host to bind to")
	dbPath     = flag.String("db", "", "Path to beads database (optional, will auto-detect)")
	socketPath = flag.String("socket", "", "Path to daemon socket (optional, will auto-detect)")
	devMode    = flag.Bool("dev", false, "Run in development mode (serve web files from disk)")
	gtDashURL  = flag.String("gt-url", "http://localhost:8081", "URL to GT Mission Control dashboard")

	upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     func(r *http.Request) bool { return true },
	}

	wsClients   = make(map[*websocket.Conn]bool)
	wsClientsMu sync.Mutex
	wsBroadcast = make(chan []byte, 256)

	daemonClient   *rpc.Client
	daemonClientMu sync.Mutex // Protects concurrent RPC calls
	webFS          fs.FS
	gtURL          string
)

func main() {
	defer func() {
		if r := recover(); r != nil {
			fmt.Fprintf(os.Stderr, "PANIC in main: %v\n", r)
		}
	}()

	flag.Parse()
	gtURL = *gtDashURL

	// Set up web file system
	if *devMode {
		fmt.Println("Running in DEVELOPMENT mode: serving web files from disk")
		webFS = os.DirFS("web")
	} else {
		var err error
		webFS, err = fs.Sub(webFiles, "web")
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error accessing embedded web files: %v\n", err)
			os.Exit(1)
		}
	}

	// Find database path
	dbPathResolved := *dbPath
	if dbPathResolved == "" {
		if foundDB := beads.FindDatabasePath(); foundDB != "" {
			dbPathResolved = foundDB
		} else {
			fmt.Fprintf(os.Stderr, "Error: no beads database found\n")
			fmt.Fprintf(os.Stderr, "Hint: run 'bd init' in your project or specify -db flag\n")
			os.Exit(1)
		}
	}

	// Resolve socket path
	socketPathResolved := *socketPath
	if socketPathResolved == "" {
		socketPathResolved = filepath.Join(filepath.Dir(dbPathResolved), "bd.sock")
	}

	// Connect to daemon
	if err := connectToDaemon(socketPathResolved, dbPathResolved); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	// Start WebSocket broadcaster and mutation polling
	go handleWebSocketBroadcast()
	go pollMutations()

	// HTTP routes
	http.HandleFunc("/", handleIndex)
	http.HandleFunc("/api/issues", handleAPIIssues)
	http.HandleFunc("/api/issues/", handleAPIIssueDetail)
	http.HandleFunc("/api/ready", handleAPIReady)
	http.HandleFunc("/api/stats", handleAPIStats)
	http.HandleFunc("/api/epics", handleAPIEpics)
	http.HandleFunc("/api/config", handleAPIConfig)
	http.HandleFunc("/ws", handleWebSocket)
	http.Handle("/static/", http.StripPrefix("/", http.FileServer(http.FS(webFS))))

	addr := fmt.Sprintf("%s:%d", *host, *port)
	fmt.Printf("\n")
	fmt.Printf("  📿 Beads Dashboard - Mission Control Style\n")
	fmt.Printf("  ────────────────────────────────────────────\n")
	fmt.Printf("  Local:     http://%s\n", addr)
	fmt.Printf("  GT Link:   %s\n", gtURL)
	fmt.Printf("  WebSocket: ws://%s/ws\n", addr)
	fmt.Printf("\n")
	fmt.Printf("  Press Ctrl+C to stop\n\n")

	if err := http.ListenAndServe(addr, nil); err != nil {
		fmt.Fprintf(os.Stderr, "Error starting server: %v\n", err)
		os.Exit(1)
	}
}

func connectToDaemon(socketPath, dbPath string) error {
	client, err := rpc.TryConnect(socketPath)
	if err != nil || client == nil {
		return fmt.Errorf("beads daemon not running\n\nStart it with: bd daemon\nThen run: %s", os.Args[0])
	}

	health, err := client.Health()
	if err != nil || health.Status != "healthy" {
		_ = client.Close()
		return fmt.Errorf("daemon not healthy\n\nTry: bd daemon --stop && bd daemon")
	}

	absDBPath, _ := filepath.Abs(dbPath)
	client.SetDatabasePath(absDBPath)
	daemonClient = client

	fmt.Printf("  ✓ Connected to daemon (v%s)\n", health.Version)
	return nil
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	data, err := fs.ReadFile(webFS, "index.html")
	if err != nil {
		http.Error(w, "Error reading index.html", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(data)
}

func handleAPIIssues(w http.ResponseWriter, r *http.Request) {
	daemonClientMu.Lock()
	defer daemonClientMu.Unlock()

	if daemonClient == nil {
		http.Error(w, "Daemon not connected", http.StatusInternalServerError)
		return
	}

	resp, err := daemonClient.List(&rpc.ListArgs{})
	if err != nil {
		http.Error(w, fmt.Sprintf("RPC error: %v", err), http.StatusInternalServerError)
		return
	}

	var issues []*types.Issue
	if err := json.Unmarshal(resp.Data, &issues); err != nil {
		http.Error(w, fmt.Sprintf("JSON error: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(issues)
}

func handleAPIIssueDetail(w http.ResponseWriter, r *http.Request) {
	issueID := r.URL.Path[len("/api/issues/"):]
	if issueID == "" {
		http.Error(w, "Issue ID required", http.StatusBadRequest)
		return
	}

	daemonClientMu.Lock()
	defer daemonClientMu.Unlock()

	if daemonClient == nil {
		http.Error(w, "Daemon not connected", http.StatusInternalServerError)
		return
	}

	resp, err := daemonClient.Show(&rpc.ShowArgs{ID: issueID})
	if err != nil {
		http.Error(w, fmt.Sprintf("Issue not found: %v", err), http.StatusNotFound)
		return
	}

	// RPC Show returns IssueDetails with labels, dependencies, dependents, comments
	var details *types.IssueDetails
	if err := json.Unmarshal(resp.Data, &details); err != nil {
		http.Error(w, fmt.Sprintf("JSON error: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(details)
}

func handleAPIReady(w http.ResponseWriter, r *http.Request) {
	daemonClientMu.Lock()
	defer daemonClientMu.Unlock()

	if daemonClient == nil {
		http.Error(w, "Daemon not connected", http.StatusInternalServerError)
		return
	}

	resp, err := daemonClient.Ready(&rpc.ReadyArgs{})
	if err != nil {
		http.Error(w, fmt.Sprintf("RPC error: %v", err), http.StatusInternalServerError)
		return
	}

	var issues []*types.Issue
	if err := json.Unmarshal(resp.Data, &issues); err != nil {
		http.Error(w, fmt.Sprintf("JSON error: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(issues)
}

func handleAPIStats(w http.ResponseWriter, r *http.Request) {
	daemonClientMu.Lock()
	defer daemonClientMu.Unlock()

	if daemonClient == nil {
		http.Error(w, "Daemon not connected", http.StatusInternalServerError)
		return
	}

	resp, err := daemonClient.Stats()
	if err != nil {
		http.Error(w, fmt.Sprintf("RPC error: %v", err), http.StatusInternalServerError)
		return
	}

	var stats *types.Statistics
	if err := json.Unmarshal(resp.Data, &stats); err != nil {
		http.Error(w, fmt.Sprintf("JSON error: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func handleAPIEpics(w http.ResponseWriter, r *http.Request) {
	daemonClientMu.Lock()
	defer daemonClientMu.Unlock()

	if daemonClient == nil {
		http.Error(w, "Daemon not connected", http.StatusInternalServerError)
		return
	}

	// Use EpicStatus RPC to get epics with child counts
	resp, err := daemonClient.EpicStatus(&rpc.EpicStatusArgs{})
	if err != nil {
		http.Error(w, fmt.Sprintf("RPC error: %v", err), http.StatusInternalServerError)
		return
	}

	var epicStatuses []*types.EpicStatus
	if err := json.Unmarshal(resp.Data, &epicStatuses); err != nil {
		http.Error(w, fmt.Sprintf("JSON error: %v", err), http.StatusInternalServerError)
		return
	}

	// Filter out tombstone epics - they are deleted and shouldn't appear in dashboard
	var filtered []*types.EpicStatus
	for _, es := range epicStatuses {
		if es.Epic != nil && es.Epic.Status != "tombstone" {
			filtered = append(filtered, es)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(filtered)
}

func handleAPIConfig(w http.ResponseWriter, r *http.Request) {
	config := map[string]string{
		"gtDashboardURL": gtURL,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	wsClientsMu.Lock()
	wsClients[conn] = true
	wsClientsMu.Unlock()

	defer func() {
		wsClientsMu.Lock()
		delete(wsClients, conn)
		wsClientsMu.Unlock()
		conn.Close()
	}()

	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

func handleWebSocketBroadcast() {
	for message := range wsBroadcast {
		wsClientsMu.Lock()
		for client := range wsClients {
			if err := client.WriteMessage(websocket.TextMessage, message); err != nil {
				client.Close()
				delete(wsClients, client)
			}
		}
		wsClientsMu.Unlock()
	}
}

func pollMutations() {
	lastPollTime := int64(0)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		daemonClientMu.Lock()
		if daemonClient == nil {
			daemonClientMu.Unlock()
			continue
		}

		resp, err := daemonClient.GetMutations(&rpc.GetMutationsArgs{Since: lastPollTime})
		daemonClientMu.Unlock()
		if err != nil {
			continue
		}

		var mutations []rpc.MutationEvent
		if err := json.Unmarshal(resp.Data, &mutations); err != nil {
			continue
		}

		for _, mutation := range mutations {
			data, _ := json.Marshal(mutation)
			wsBroadcast <- data
			if ts := mutation.Timestamp.UnixMilli(); ts > lastPollTime {
				lastPollTime = ts
			}
		}
	}
}
