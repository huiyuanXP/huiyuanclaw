# huiyuanClaw

**Control AI coding agents from your phone.** Orchestrate multiple AI sessions, chain tasks with dependencies, and manage your entire dev workflow — all from a browser.

![Chat UI](docs/demo.gif)

huiyuanClaw is a lightweight orchestrator that runs on your Mac or Linux server, giving you a web-based control center for AI coding tools (Claude Code, Codex, Cline). No SSH, no VPN — just HTTPS via Cloudflare Tunnel.

---

## Why huiyuanClaw?

Most AI coding tools are single-session, single-machine, terminal-only. huiyuanClaw changes that:

| Problem | huiyuanClaw Solution |
|---------|---------------------|
| Can't use AI tools from phone/tablet | Browser-based chat UI over HTTPS |
| Sessions die when you close the terminal | Persistent sessions — disconnect and reconnect anytime |
| One AI session at a time | Multiple parallel sessions across different projects |
| No coordination between AI agents | Task dependency system with auto-dispatch |
| Manual orchestration of multi-step work | Workflow engine with scheduling and team templates |
| No MCP integration for agent-to-agent | Built-in MCP server for programmatic session control |

---

## Design Philosophy

**Delegation over execution.** huiyuanClaw is an orchestrator, not a monolith. It dispatches work to the right agent, holds the big picture, and keeps things moving.

Core principles:

1. **Simplicity beats complexity** — ~7K lines of core code. No database, no framework overhead. Just Node.js, JSON files, and WebSockets.
2. **Task-first coordination** — Dependencies are explicit, not hidden. Tasks flow through `blocked → pending → in_progress → completed`, and the system auto-dispatches when dependencies clear.
3. **Every tool is replaceable; judgment is not** — Claude, Codex, Cline are interchangeable execution backends. The orchestration layer is what matters.
4. **Persistent by default** — Sessions survive disconnects, server restarts, and browser closes. History lives on disk as JSONL.
5. **MCP-native** — Agent-to-agent communication via Model Context Protocol. Your orchestrator can create sessions, send messages, and manage tasks programmatically.

---

## Features

### Multi-Session Chat UI

<!-- TODO: Screenshot — main dashboard with sidebar + chat -->
<!-- ![Dashboard](docs/screenshots/dashboard.png) -->

- Create sessions per project folder with your choice of AI tool (Claude Code, Codex, Cline)
- Real-time streaming responses via WebSocket
- Paste images directly into chat (screenshots, diagrams)
- Session history persisted on disk — close browser, come back, it's all there
- Dark/light themes, mobile-friendly PWA

### Task Dependency System

Chain complex workflows with automatic dependency resolution:

```
Task A (research)     ─┐
                       ├──→ Task C (integrate)  ──→ Task D (test)
Task B (implement)    ─┘
```

When Task A completes, the system automatically checks if Task C's dependencies are all met. If so, it dispatches Task C to its assigned session — no polling, no manual intervention.

```javascript
// Create tasks with dependencies via MCP
create_task({
  subject: "Backend implementation",
  assigned_session_id: "abc123",
  blocked_by: ["task-id-for-design"]  // Auto-starts when design completes
})
```

Task states: `pending` → `in_progress` → `completed` (or `blocked` if dependencies exist)

### Team Templates

Spin up a coordinated team of AI agents with one command:

```javascript
launch_team({
  template_name: "software-dev",
  goal: "Build user authentication system",
  goal_folder: "~/my-project",
  team_name: "auth-v2"
})
```

Built-in templates:

| Template | Roles | Flow |
|----------|-------|------|
| `software-dev` | Leader → Backend + Frontend → Tester | Leader designs, devs implement in parallel, tester validates |
| `research` | Researcher → Analyzer → Writer | Gather data → analyze → write report |

Each role gets its own session, tasks are created with proper dependency chains, and the first unblocked task auto-starts.

### MCP Server (Model Context Protocol)

huiyuanClaw exposes its full API as MCP tools, enabling programmatic orchestration from any MCP-compatible client (Claude Code, etc.):

**Session tools:**
- `create_session` / `delete_session` — Manage AI agent sessions
- `send_message` — Send instructions to any session (async or sync with `wait: true`)
- `get_session` / `list_sessions` — Monitor session state
- `get_session_history` — Retrieve full conversation history

**Task tools:**
- `create_task` / `update_task` — Create and manage tasks with dependencies
- `list_tasks` / `get_task` — Query task state
- `launch_team` — Instantiate team templates

**System tools:**
- `set_label` / `list_labels` — Tag sessions with status labels (e.g., `pending-review`, `done`)
- `schedule_message` — Schedule one-shot or recurring messages
- `restart_server` — Graceful or immediate server restart
- `submit_report` — Submit HTML reports

#### Two-Tier MCP Architecture

| Layer | Scope | Who uses it |
|-------|-------|-------------|
| **Session MCP** (`mcp-server.mjs`) | Full control — sessions, messages, labels, tasks | Orchestrator workspace only |
| **Task MCP** (`mcp-task-server.mjs`) | Tasks only — create, update, list | All workspaces (sub-agents) |

This separation ensures sub-agents can report task completion without having access to session management.

### Workflow Engine & Scheduling

Define multi-step workflows with parallel and sequential execution:

```json
{
  "name": "daily-summary",
  "steps": [
    {
      "id": "gather",
      "type": "parallel",
      "tasks": [
        { "id": "news", "workspace": "~/DailyNews", "prompt": "Summarize today..." },
        { "id": "market", "workspace": "~/MarketClaw", "prompt": "Market update..." }
      ]
    },
    {
      "id": "report",
      "type": "sequential",
      "tasks": [
        { "prompt": "Write report using {{gather.results.news}} and {{gather.results.market}}" }
      ]
    }
  ]
}
```

Schedule workflows with cron expressions:

```json
{
  "id": "daily-summary",
  "enabled": true,
  "cron": "0 5 * * *",
  "workflow": "daily-summary.json",
  "disposable": true
}
```

Features:
- Parallel and sequential step execution
- Placeholder resolution (`{{step.results}}`)
- Disposable sessions (auto-archive after workflow completes)
- Max run limits and missed-run detection

### Session Labels

Tag sessions with custom status labels for visual organization:

| Label | Meaning |
|-------|---------|
| `pending-review` | Work done, waiting for human review |
| `planned` | Task understood, not yet started |
| `done` | Completed, no attention needed |

Labels show as color-coded indicators in the UI, letting you scan dozens of sessions at a glance.

### Shared Profile Injection

All sessions automatically load shared context files on startup:

```
~/.huiyuanclaw/
├── USER.md      # Who you are, your goals, collaboration style
├── SOUL.md      # Agent identity and role
├── TOOLS.md     # Available tools and credentials reference
└── MEMORY.md    # Long-term memory (cross-session)
```

This gives every AI agent consistent context about you and your project without repeating yourself.

### Git Integration

Built-in Git operations from the UI:

- View diffs for any session's working directory
- Stage files, commit changes, view log
- Branch management (list, checkout, pull, push)

---

## Quick Start

### Prerequisites

- **Node.js 18+**
- **macOS**: Homebrew installed
- **Linux**: `dtach` + `ttyd` (setup wizard can install these)
- At least one AI CLI tool installed (`claude`, `codex`, or `cline`)
- A domain on Cloudflare (free account, domain ~$1–12/yr)

### Option 1: AI-Guided Setup (Recommended)

Paste this prompt into Claude Code on your server:

```
I want to set up huiyuanClaw on this machine so I can control AI coding tools from my phone.

My domain: [YOUR_DOMAIN]          (e.g. example.com)
Subdomain I want to use: [SUBDOMAIN]  (e.g. chat — will create chat.example.com)

Please follow the full setup guide at docs/setup.md in this repository.
Do every step you can automatically. When you hit a [HUMAN] step, stop and tell me exactly what to do.
After I confirm each manual step, continue to the next phase.
```

### Option 2: Manual Setup

```bash
# Clone and install
git clone https://github.com/huiyuanXP/huiyuanclaw.git
cd huiyuanclaw
npm install
npm link    # makes `remotelab` available globally

# macOS dependencies
brew install dtach ttyd cloudflared

# Linux dependencies
sudo apt-get install -y dtach
# ttyd: https://github.com/tsl0922/ttyd/releases
# cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

# Run interactive setup
remotelab setup

# Start services
remotelab start
```

### Option 3: Set Up a Workspace (For Orchestrator Users)

If you want to use huiyuanClaw as a multi-workspace orchestrator (recommended for power users):

```bash
# After basic setup, create your orchestrator workspace
./setup-workspace.sh
```

This interactive script sets up:
- An orchestrator workspace with MCP configuration
- Shared profile directory (`~/.huiyuanclaw/`)
- Claude Code settings for the orchestrator
- Template files (AGENTS.md, SOUL.md, etc.)

See [Workspace Setup](#workspace-setup) for details.

---

## Architecture

```
Phone/Browser ──HTTPS──→ Cloudflare Tunnel ──→ chat-server :7690
                                                     │
                                               spawns subprocess
                                               (claude / codex / cline)
                                                     │
                                               streams events → WebSocket → browser
```

Two services run on your machine:

| Service | Port | Role |
|---------|------|------|
| `chat-server.mjs` | 7690 | **Primary.** Chat UI, session management, task system, WebSocket streaming |
| `auth-proxy.mjs` | 7681 | **Fallback.** Raw terminal via ttyd — emergency access only |

### Key Components

```
chat-server.mjs
├── router.mjs           — HTTP API (sessions, tasks, git, reports)
├── session-manager.mjs  — Session lifecycle, process spawning, event history
├── process-runner.mjs   — Tool adapters (Claude, Codex, Cline)
├── task-manager.mjs     — Task CRUD + dependency resolution
├── scheduler.mjs        — Cron/interval-based scheduling
├── workflow-engine.mjs  — Multi-step workflow execution
├── ws.mjs               — WebSocket real-time event streaming
└── reports.mjs          — HTML report submission & validation
```

### Data Flow

All state is stored in JSON files — no database required:

```
~/.config/claude-web/
├── auth.json              # Access token
├── chat-sessions.json     # Session metadata
├── chat-history/*.jsonl   # Per-session event logs
├── tasks.json             # Task database
├── reports.json           # Report metadata
├── session-labels.json    # Session status tags
└── workflow-runs/         # Workflow execution logs
```

---

## Workspace Setup

huiyuanClaw supports a multi-workspace architecture where an **orchestrator** delegates work to **sub-workspaces**:

```
Orchestrator (RLOrchestrator)
├── sends messages to ──→ ResearchCenter (research tasks)
├── sends messages to ──→ ProjectA (development tasks)
└── sends messages to ──→ ProjectB (development tasks)
```

### How It Works

1. The **Orchestrator** has full MCP access (sessions + tasks)
2. **Sub-workspaces** only have task MCP access (report completion, no session control)
3. Tasks flow: Orchestrator creates task → assigns to session → sub-agent works → reports completion → dependency chain advances

### Setting Up with the Script

```bash
./setup-workspace.sh
```

The interactive setup will:

1. **Create shared profile directory** (`~/.huiyuanclaw/`) with template files:
   - `USER.md` — Your identity and goals
   - `SOUL.md` — Agent personality
   - `TOOLS.md` — Tool inventory
   - `MEMORY.md` — Cross-session memory

2. **Create orchestrator workspace** with:
   - `.mcp.json` — MCP server configuration pointing to `mcp-server.mjs`
   - `CLAUDE.md` / `AGENTS.md` — Agent protocols
   - `memory/` — Daily logs directory

3. **Configure Claude Code settings** for:
   - Task MCP (global, available to all workspaces)
   - Permission allowlists
   - Model preferences

---

## CLI Reference

```
remotelab setup                Run interactive setup wizard
remotelab start                Start all services
remotelab stop                 Stop all services
remotelab restart [service]    Restart: chat | proxy | tunnel | all
remotelab chat                 Run chat server in foreground (debug)
remotelab server               Run auth proxy in foreground (debug)
remotelab generate-token       Generate a new access token
remotelab set-password         Set username & password (alternative to token)
remotelab --help               Show help
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CHAT_PORT` | `7690` | Chat server port |
| `LISTEN_PORT` | `7681` | Auth proxy port |
| `SESSION_EXPIRY` | `86400000` | Cookie lifetime in ms (24h) |
| `SECURE_COOKIES` | `1` | Set `0` for localhost without HTTPS |
| `AUTO_COMPACT_THRESHOLD` | `0.80` | Context auto-compress at this % of window |
| `CONTEXT_WINDOW_SIZE` | `200000` | Token window size |

## Security

- **HTTPS** via Cloudflare (TLS at edge, localhost HTTP internally)
- **256-bit random access token** with timing-safe comparison
- **Optional scrypt-hashed password** login
- **HttpOnly + Secure + SameSite=Strict** session cookies (24h expiry)
- **Per-IP rate limiting** with exponential backoff on failed login (1→2→4→15 min)
- **Server binds to 127.0.0.1 only** — no direct external exposure
- **CSP headers** with nonce-based script allowlist

## API Reference

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List all sessions |
| `POST` | `/api/sessions` | Create session `{folder, tool, name}` |
| `GET` | `/api/sessions/:id` | Get session details |
| `DELETE` | `/api/sessions/:id` | Delete session |
| `POST` | `/api/sessions/:id/messages` | Send message `{text, model?, images?}` |
| `GET` | `/api/sessions/:id/history` | Get event history |
| `PATCH` | `/api/sessions/:id/label` | Set session label |
| `POST` | `/api/sessions/:id/recover` | Recover crashed session |

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tasks` | List tasks (filter by `?status=` or `?assigned_session_id=`) |
| `POST` | `/api/tasks` | Create task `{subject, description?, blocked_by?, assigned_session_id?}` |
| `GET` | `/api/tasks/:id` | Get task details |
| `PATCH` | `/api/tasks/:id` | Update task `{status?, subject?, description?}` |
| `DELETE` | `/api/tasks/:id` | Delete task |

### Git

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/git/diff?session_id=` | View diff for session's working directory |
| `POST` | `/api/git/stage` | Stage files |
| `POST` | `/api/git/commit` | Commit changes |
| `GET` | `/api/git/log?session_id=` | View git log |
| `GET` | `/api/git/branches?session_id=` | List branches |
| `POST` | `/api/git/checkout` | Switch branch |

### WebSocket

Connect to `/ws?token=YOUR_TOKEN` for real-time event streaming.

Event types: `message`, `status:change`, `tool:use`, `compact:start`, `session:created`, `session:deleted`, `label:change`, `task:update`

## Troubleshooting

**Service won't start (macOS):**
```bash
tail -50 ~/Library/Logs/chat-server.error.log
tail -50 ~/Library/Logs/auth-proxy.error.log
```

**Service won't start (Linux):**
```bash
journalctl --user -u remotelab-chat -n 50
tail -50 ~/.local/share/remotelab/logs/chat-server.error.log
```

**DNS not resolving:** Wait 5–30 minutes after setup. Verify: `dig SUBDOMAIN.DOMAIN +short`

**Port already in use:**
```bash
lsof -i :7690   # chat server
lsof -i :7681   # auth proxy
```

**Restart a single service:**
```bash
remotelab restart chat
remotelab restart proxy
remotelab restart tunnel
```

---

## Contributing

Contributions welcome! Please open an issue first to discuss what you'd like to change.

## License

MIT
