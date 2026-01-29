// Beads Dashboard - Mission Control Integration
// Real-time issue tracking with GT Mission Control linking

let allIssues = [];
let readyIssues = [];
let epics = [];
let ws = null;
let wsConnected = false;
let gtDashboardURL = 'http://localhost:8081';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    connectWebSocket();
    loadStats();
    loadReadyQueue();
    loadEpics();
    loadAllIssues();
    setupEventListeners();
});

// Load config (GT dashboard URL)
async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        if (response.ok) {
            const config = await response.json();
            gtDashboardURL = config.gtDashboardURL || gtDashboardURL;
            document.getElementById('nav-gt').href = gtDashboardURL;
        }
    } catch (error) {
        console.error('Error loading config:', error);
    }
}

// WebSocket connection
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        wsConnected = true;
        updateConnectionStatus(true);
    };

    ws.onmessage = (event) => {
        const mutation = JSON.parse(event.data);
        handleMutation(mutation);
    };

    ws.onerror = () => {
        wsConnected = false;
        updateConnectionStatus(false);
    };

    ws.onclose = () => {
        wsConnected = false;
        updateConnectionStatus(false);
        setTimeout(connectWebSocket, 5000);
    };
}

function updateConnectionStatus(connected) {
    const indicator = document.getElementById('connection-status');
    const text = document.getElementById('connection-text');

    if (connected) {
        indicator.className = 'live-indicator connected';
        text.textContent = 'Live';
    } else {
        indicator.className = 'live-indicator disconnected';
        text.textContent = 'Disconnected';
    }
}

function handleMutation(mutation) {
    // Refresh all data on any mutation
    loadStats();
    loadReadyQueue();
    loadEpics();
    loadAllIssues();
    updateLastUpdated();
}

function updateLastUpdated() {
    document.getElementById('last-updated').textContent = 'Updated just now';
}

// Load statistics
async function loadStats() {
    try {
        const [statsRes, readyRes] = await Promise.all([
            fetch('/api/stats'),
            fetch('/api/ready')
        ]);

        if (statsRes.ok) {
            const stats = await statsRes.json();
            document.querySelector('#stat-total .value').textContent = stats.total_issues || 0;
            document.querySelector('#stat-open .value').textContent = stats.open_issues || 0;
            document.querySelector('#stat-in-progress .value').textContent = stats.in_progress_issues || 0;
        }

        if (readyRes.ok) {
            const ready = await readyRes.json();
            document.querySelector('#stat-ready .value').textContent = ready ? ready.length : 0;
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Load Ready Queue
async function loadReadyQueue() {
    try {
        const response = await fetch('/api/ready');
        if (!response.ok) throw new Error('Failed to load ready queue');

        readyIssues = await response.json() || [];
        renderReadyQueue();
    } catch (error) {
        console.error('Error loading ready queue:', error);
        document.getElementById('ready-tbody').innerHTML =
            '<tr><td colspan="5" class="loading-cell">Error loading data</td></tr>';
    }
}

function renderReadyQueue() {
    const tbody = document.getElementById('ready-tbody');
    const empty = document.getElementById('ready-empty');
    const table = document.getElementById('ready-table');

    if (!readyIssues || readyIssues.length === 0) {
        tbody.innerHTML = '';
        empty.style.display = 'block';
        table.style.display = 'none';
        return;
    }

    table.style.display = '';
    empty.style.display = 'none';

    // Sort by priority (P0 first)
    const sorted = [...readyIssues].sort((a, b) => (a.priority || 2) - (b.priority || 2));

    tbody.innerHTML = sorted.map(issue => `
        <tr onclick="showIssueDetail('${issue.id}')">
            <td><span class="priority-badge priority-${issue.priority || 2}">P${issue.priority || 2}</span></td>
            <td><span class="issue-id">${issue.id}</span></td>
            <td class="text-left">${escapeHtml(issue.title)}</td>
            <td><span class="type-badge type-${issue.issue_type || 'task'}">${issue.issue_type || 'task'}</span></td>
            <td><button class="action-btn primary" onclick="event.stopPropagation(); selectForConvoy('${issue.id}')">Select</button></td>
        </tr>
    `).join('');
}

// Load Epics
async function loadEpics() {
    try {
        const response = await fetch('/api/epics');
        if (!response.ok) throw new Error('Failed to load epics');

        epics = await response.json() || [];
        renderEpics();
    } catch (error) {
        console.error('Error loading epics:', error);
    }
}

function renderEpics() {
    const tbody = document.getElementById('epics-tbody');
    const empty = document.getElementById('epics-empty');
    const table = document.getElementById('epics-table');

    if (!epics || epics.length === 0) {
        tbody.innerHTML = '';
        empty.style.display = 'block';
        table.style.display = 'none';
        return;
    }

    table.style.display = '';
    empty.style.display = 'none';

    tbody.innerHTML = epics.map(epic => `
        <tr onclick="showIssueDetail('${epic.id}')">
            <td><span class="status-badge status-${epic.status}">${formatStatus(epic.status)}</span></td>
            <td><span class="issue-id">${epic.id}</span></td>
            <td class="text-left">${escapeHtml(epic.title)}</td>
            <td>-</td>
            <td><button class="action-btn" onclick="event.stopPropagation(); showIssueDetail('${epic.id}')">View</button></td>
        </tr>
    `).join('');
}

// Load All Issues
async function loadAllIssues() {
    try {
        const response = await fetch('/api/issues');
        if (!response.ok) throw new Error('Failed to load issues');

        allIssues = await response.json() || [];
        filterAndRenderAll();
    } catch (error) {
        console.error('Error loading issues:', error);
    }
}

function filterAndRenderAll() {
    const statusFilter = document.getElementById('filter-status').value;
    const priorityFilter = document.getElementById('filter-priority').value;
    const typeFilter = document.getElementById('filter-type').value;
    const textFilter = document.getElementById('filter-text').value.toLowerCase();

    let filtered = allIssues.filter(issue => {
        if (statusFilter && issue.status !== statusFilter) return false;
        if (priorityFilter !== '' && issue.priority !== parseInt(priorityFilter)) return false;
        if (typeFilter && issue.issue_type !== typeFilter) return false;
        if (textFilter) {
            const title = (issue.title || '').toLowerCase();
            const desc = (issue.description || '').toLowerCase();
            const id = (issue.id || '').toLowerCase();
            if (!title.includes(textFilter) && !desc.includes(textFilter) && !id.includes(textFilter)) {
                return false;
            }
        }
        return true;
    });

    renderAllIssues(filtered);
}

function renderAllIssues(issues) {
    const tbody = document.getElementById('all-tbody');
    const empty = document.getElementById('all-empty');
    const table = document.getElementById('all-table');

    if (!issues || issues.length === 0) {
        tbody.innerHTML = '';
        empty.style.display = 'block';
        table.style.display = 'none';
        return;
    }

    table.style.display = '';
    empty.style.display = 'none';

    // Sort by status (in_progress first), then priority
    const sorted = [...issues].sort((a, b) => {
        const statusOrder = { 'in_progress': 0, 'open': 1, 'closed': 2 };
        const statusDiff = (statusOrder[a.status] || 1) - (statusOrder[b.status] || 1);
        if (statusDiff !== 0) return statusDiff;
        return (a.priority || 2) - (b.priority || 2);
    });

    tbody.innerHTML = sorted.map(issue => `
        <tr onclick="showIssueDetail('${issue.id}')">
            <td><span class="status-badge status-${issue.status}">${formatStatus(issue.status)}</span></td>
            <td><span class="priority-badge priority-${issue.priority || 2}">P${issue.priority || 2}</span></td>
            <td><span class="issue-id">${issue.id}</span></td>
            <td class="text-left">${escapeHtml(issue.title)}</td>
            <td><span class="type-badge type-${issue.issue_type || 'task'}">${issue.issue_type || 'task'}</span></td>
            <td><button class="action-btn" onclick="event.stopPropagation(); showIssueDetail('${issue.id}')">View</button></td>
        </tr>
    `).join('');
}

// Show issue detail modal
async function showIssueDetail(issueId) {
    const modal = document.getElementById('issue-modal');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');

    modal.classList.add('active');
    title.textContent = 'Loading...';
    body.innerHTML = '<div class="spinner"></div>';

    try {
        const response = await fetch(`/api/issues/${issueId}`);
        if (!response.ok) throw new Error('Issue not found');

        const issue = await response.json();
        title.textContent = `${issue.id}: ${issue.title}`;

        body.innerHTML = `
            <div class="detail-row">
                <span class="detail-label">Status</span>
                <span class="detail-value"><span class="status-badge status-${issue.status}">${formatStatus(issue.status)}</span></span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Priority</span>
                <span class="detail-value"><span class="priority-badge priority-${issue.priority || 2}">P${issue.priority || 2}</span></span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Type</span>
                <span class="detail-value"><span class="type-badge type-${issue.issue_type || 'task'}">${issue.issue_type || 'task'}</span></span>
            </div>
            ${issue.assignee ? `
            <div class="detail-row">
                <span class="detail-label">Assignee</span>
                <span class="detail-value">${escapeHtml(issue.assignee)}</span>
            </div>
            ` : ''}
            <div class="detail-row">
                <span class="detail-label">Created</span>
                <span class="detail-value">${formatDate(issue.created_at)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Updated</span>
                <span class="detail-value">${formatDate(issue.updated_at)}</span>
            </div>
            ${issue.description ? `
            <div class="detail-section">
                <h4>Description</h4>
                <pre>${escapeHtml(issue.description)}</pre>
            </div>
            ` : ''}
            ${issue.design ? `
            <div class="detail-section">
                <h4>Design</h4>
                <pre>${escapeHtml(issue.design)}</pre>
            </div>
            ` : ''}
            ${issue.acceptance_criteria ? `
            <div class="detail-section">
                <h4>Acceptance Criteria</h4>
                <pre>${escapeHtml(issue.acceptance_criteria)}</pre>
            </div>
            ` : ''}
            ${issue.notes ? `
            <div class="detail-section">
                <h4>Notes</h4>
                <pre>${escapeHtml(issue.notes)}</pre>
            </div>
            ` : ''}
        `;
    } catch (error) {
        body.innerHTML = '<p>Error loading issue details</p>';
    }
}

function closeModal() {
    document.getElementById('issue-modal').classList.remove('active');
}

// Select for convoy (placeholder - future integration)
function selectForConvoy(issueId) {
    // TODO: Implement convoy creation integration
    alert(`Selected ${issueId} for convoy.\n\nFuture: This will integrate with GT convoy creation.`);
}

// Setup event listeners
function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;

            // Update tabs
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update views
            document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
            document.getElementById(`view-${view}`).classList.add('active');
        });
    });

    // Filters
    document.getElementById('filter-status').addEventListener('change', filterAndRenderAll);
    document.getElementById('filter-priority').addEventListener('change', filterAndRenderAll);
    document.getElementById('filter-type').addEventListener('change', filterAndRenderAll);
    document.getElementById('filter-text').addEventListener('input', filterAndRenderAll);

    // Modal close
    document.querySelector('.modal-close').addEventListener('click', closeModal);
    document.getElementById('issue-modal').addEventListener('click', (e) => {
        if (e.target.id === 'issue-modal') closeModal();
    });

    // Stat clicks for filtering
    document.getElementById('stat-ready').addEventListener('click', () => {
        document.querySelector('[data-view="ready"]').click();
    });

    document.getElementById('stat-in-progress').addEventListener('click', () => {
        document.querySelector('[data-view="all"]').click();
        document.getElementById('filter-status').value = 'in_progress';
        filterAndRenderAll();
    });

    document.getElementById('stat-open').addEventListener('click', () => {
        document.querySelector('[data-view="all"]').click();
        document.getElementById('filter-status').value = 'open';
        filterAndRenderAll();
    });

    // GT navigation
    document.getElementById('nav-gt').addEventListener('click', (e) => {
        e.preventDefault();
        window.open(gtDashboardURL, '_blank');
    });
}

// Helpers
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatStatus(status) {
    const map = {
        'open': 'Open',
        'in_progress': 'Active',
        'closed': 'Closed'
    };
    return map[status] || status;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Fallback refresh
setInterval(() => {
    if (!wsConnected) {
        loadStats();
        loadReadyQueue();
    }
}, 30000);
