# Beads Dashboard - Mission Control Style

Real-time issue tracking dashboard styled to match GT Mission Control for unified monitoring experience.

## Features

- **Ready Queue View**: Issues with no blockers, ready for convoy assignment
- **Epics View**: Parent issues organizing related work with child progress
- **All Issues View**: Full issue list with status, priority, type, and text filters
- **Real-time Updates**: WebSocket connection with 2s mutation polling
- **Issue Details Modal**: Full issue information including labels, dependencies, children, comments
- **Mission Control Link**: Quick navigation to GT dashboard

## Requirements

- Go 1.24+
- Beads daemon running (`bd daemon`)
- Beads database initialized (`bd init`)

## Quick Start

```bash
# Start the beads daemon (if not running)
bd daemon

# Run the dashboard
cd examples/mission-control-dashboard
go build -o mission-control-dashboard .
./mission-control-dashboard

# Open in browser
open http://localhost:8082
```

## CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `-port` | 8082 | Port for web server |
| `-host` | localhost | Host to bind to |
| `-db` | (auto-detect) | Path to beads database |
| `-socket` | (auto-detect) | Path to daemon socket |
| `-dev` | false | Development mode (serve files from disk) |
| `-gt-url` | http://localhost:8081 | URL to GT Mission Control dashboard |

## Development Mode

For rapid iteration on frontend changes:

```bash
# Run with --dev flag to serve files from disk
./mission-control-dashboard --dev

# Edit web/index.html, web/static/js/app.js, web/static/css/styles.css
# Changes appear on browser refresh (no rebuild needed)
```

**Production builds**: Static files are embedded via `//go:embed web`. Must rebuild binary for changes to take effect:

```bash
go build -o mission-control-dashboard .
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/issues` | GET | List all issues |
| `/api/issues/{id}` | GET | Get issue details with labels, dependencies, comments |
| `/api/ready` | GET | Get ready queue (issues with no blockers) |
| `/api/stats` | GET | Get statistics (total, open, in_progress counts) |
| `/api/epics` | GET | Get epics with child counts |
| `/api/config` | GET | Get configuration (GT dashboard URL) |
| `/health` | GET | Health check (daemon connection, WebSocket clients) |
| `/ws` | WebSocket | Real-time mutation stream |

### Example API Responses

**GET /api/stats**
```json
{
  "total_issues": 193,
  "open_issues": 38,
  "in_progress_issues": 1,
  "closed_issues": 154
}
```

**GET /health**
```json
{
  "status": "healthy",
  "daemon_connected": true,
  "websocket_clients": 2
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  BEADS DASHBOARD - Mission Control Style                        │
├─────────────────────────────────────────────────────────────────┤
│  Tech Stack: Go 1.24 + Vanilla JS + CSS3 (dark theme)          │
│  Real-time: WebSocket + 2s mutation polling + 30s fallback     │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │────►│  Dashboard   │────►│   Daemon     │
│              │◄────│   (Go)       │◄────│   (RPC)      │
└──────────────┘     └──────────────┘     └──────────────┘
       │ WS                                      │
       └───────────────WebSocket────────────────┘
                   (2s mutation poll)
```

## File Structure

```
mission-control-dashboard/
├── main.go              # Go backend (RPC client, HTTP handlers, WebSocket)
├── web/
│   ├── index.html       # Dashboard HTML template
│   └── static/
│       ├── css/
│       │   └── styles.css   # Mission Control dark theme
│       └── js/
│           └── app.js       # Client-side logic
└── README.md            # This file
```

## Filtering

### Type Presets

| Preset | Types Included |
|--------|----------------|
| Work Only (default) | task, bug, feature, epic, chore |
| System Only | message, event, convoy, molecule, gate, agent, role |
| All Types | Everything |

### Filter Combinations

Filters combine with AND logic:
- Status: open, in_progress, closed
- Priority: P0 (critical), P1 (high), P2 (normal), P3 (low)
- Type: Preset or specific type
- Text: Searches title, description, and ID

## Troubleshooting

### "Daemon not running"

```bash
# Start the daemon
bd daemon

# Check daemon status
bd health
```

### "Database not found"

```bash
# Initialize beads in your project
cd your-project
bd init

# Or specify database path
./mission-control-dashboard -db /path/to/.beads/beads.db
```

### WebSocket Disconnects

Dashboard automatically reconnects after 5 seconds. Falls back to 30-second polling when WebSocket is unavailable.

## Related

- [Beads Documentation](https://github.com/steveyegge/beads)
- [Gas Town Mission Control](../../gastown/)
