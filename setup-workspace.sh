#!/bin/bash
set -e

# ============================================================
# huiyuanClaw Workspace Setup
# Sets up an orchestrator workspace with MCP, shared profiles,
# and Claude Code configuration.
# ============================================================

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

print_header() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}$1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_success() { echo -e "  ${GREEN}✓${NC} $1"; }
print_error()   { echo -e "  ${RED}✗${NC} $1"; }
print_info()    { echo -e "  ${BLUE}→${NC} $1"; }
print_warn()    { echo -e "  ${YELLOW}!${NC} $1"; }

ask() {
    local prompt="$1"
    local default="$2"
    local result
    if [ -n "$default" ]; then
        echo -en "  ${BOLD}$prompt${NC} [${default}]: "
    else
        echo -en "  ${BOLD}$prompt${NC}: "
    fi
    read -r result
    echo "${result:-$default}"
}

ask_yn() {
    local prompt="$1"
    local default="${2:-y}"
    local result
    echo -en "  ${BOLD}$prompt${NC} [${default}]: "
    read -r result
    result="${result:-$default}"
    [[ "$result" =~ ^[Yy] ]]
}

# ============================================================
print_header "huiyuanClaw Workspace Setup"

echo "  This script sets up your orchestrator workspace and shared"
echo "  profile for multi-agent coordination via huiyuanClaw."
echo ""
echo "  What gets created:"
echo "    1. Shared profile directory (~/.huiyuanclaw/)"
echo "    2. Orchestrator workspace (your main control center)"
echo "    3. Claude Code MCP configuration"
echo "    4. Agent protocol files (AGENTS.md, etc.)"
echo ""

if ! ask_yn "Continue?" "y"; then
    echo "  Aborted."
    exit 0
fi

# ============================================================
print_header "Step 1: Shared Profile"

PROFILE_DIR="$HOME/.huiyuanclaw"

if [ -d "$PROFILE_DIR" ]; then
    print_info "Shared profile directory already exists: $PROFILE_DIR"
    if ask_yn "Overwrite existing profile files?" "n"; then
        OVERWRITE_PROFILE=true
    else
        OVERWRITE_PROFILE=false
    fi
else
    mkdir -p "$PROFILE_DIR/memory"
    print_success "Created $PROFILE_DIR"
    OVERWRITE_PROFILE=true
fi

if [ "$OVERWRITE_PROFILE" = true ]; then
    # USER.md
    echo ""
    print_info "Let's set up your identity (USER.md)"
    USER_NAME=$(ask "Your name" "")
    USER_ROLE=$(ask "Your role (e.g., developer, founder, student)" "developer")
    USER_LANG=$(ask "Preferred language" "English")
    USER_GOALS=$(ask "Your main goal with huiyuanClaw" "Orchestrate AI agents for development")

    cat > "$PROFILE_DIR/USER.md" << USEREOF
# $USER_NAME

## How to Address
**Name:** $USER_NAME
**Language:** $USER_LANG

## Who You Are
- $USER_ROLE
- Goal: $USER_GOALS

## Collaboration Style
- Prefers concise, direct communication
- Values simplicity over complexity
USEREOF
    print_success "Created USER.md"

    # SOUL.md
    AGENT_NAME=$(ask "Name for your orchestrator agent" "Orchestrator")

    cat > "$PROFILE_DIR/SOUL.md" << SOULEOF
# $AGENT_NAME

## Identity
**Name:** $AGENT_NAME
**Role:** Lightweight orchestrator — dispatches work, holds the big picture

## Core Beliefs
- Simplicity beats complexity
- Delegation over direct execution
- Every tool is replaceable; judgment is not

## Role
> I am the scheduler. I see the whole board, assign the right piece to the right agent, and keep the mission moving.
SOULEOF
    print_success "Created SOUL.md"

    # TOOLS.md
    cat > "$PROFILE_DIR/TOOLS.md" << 'TOOLSEOF'
# TOOLS.md — Tools & Auth

## Authentication

| Service | Location | Notes |
|---------|----------|-------|
| RemoteLab | ~/.config/claude-web/auth.json | Auto-generated |

> Never store secrets in plaintext in this file.

## RemoteLab

- Sessions managed via `mcp__remotelab__*` tools
- Each workspace maps to a remotelab folder
- Before creating a session, run `list_folders` to confirm path

### Label Protocol

| Scenario | Label | Description |
|----------|-------|-------------|
| Task complete, needs review | `pending-review` | Work done, waiting for human |
| Task planned but not started | `planned` | Understood, not yet executing |
| Task done, no attention needed | `done` | Completed, move on |
TOOLSEOF
    print_success "Created TOOLS.md"

    # MEMORY.md
    if [ ! -f "$PROFILE_DIR/MEMORY.md" ]; then
        cat > "$PROFILE_DIR/MEMORY.md" << 'MEMEOF'
# MEMORY.md — Global Long-Term Memory

> Important cross-workspace information. Updated as you work.
MEMEOF
        print_success "Created MEMORY.md"
    else
        print_info "MEMORY.md already exists, keeping it"
    fi
fi

# ============================================================
print_header "Step 2: Orchestrator Workspace"

DEFAULT_ORCH_DIR="$HOME/Orchestrator"
ORCH_DIR=$(ask "Orchestrator workspace path" "$DEFAULT_ORCH_DIR")

# Expand ~ if user typed it
ORCH_DIR="${ORCH_DIR/#\~/$HOME}"

if [ -d "$ORCH_DIR" ]; then
    print_info "Directory already exists: $ORCH_DIR"
    if ! ask_yn "Set up orchestrator files here?" "y"; then
        echo "  Aborted."
        exit 0
    fi
else
    mkdir -p "$ORCH_DIR"
    print_success "Created $ORCH_DIR"
fi

mkdir -p "$ORCH_DIR/memory"
mkdir -p "$ORCH_DIR/.claude"

# CLAUDE.md
cat > "$ORCH_DIR/CLAUDE.md" << 'CLAUDEEOF'
@AGENTS.md
CLAUDEEOF
print_success "Created CLAUDE.md"

# AGENTS.md
cat > "$ORCH_DIR/AGENTS.md" << AGENTSEOF
# AGENTS.md — Orchestrator

## Startup Protocol

### Step 1 — Read Shared Profile

| File | Content | Required? |
|------|---------|-----------|
| \`~/.huiyuanclaw/USER.md\` | Who you are, goals, style | Yes |
| \`~/.huiyuanclaw/MEMORY.md\` | Global long-term memory | Main session only |

### Step 2 — Read Workspace Identity

| File | Content |
|------|---------|
| \`~/.huiyuanclaw/SOUL.md\` | Agent identity |
| \`~/.huiyuanclaw/TOOLS.md\` | Tool inventory |

### Step 3 — Read this workspace's CLAUDE.md

### Step 4 — Read recent logs

\`memory/<today>.md\` and \`memory/<yesterday>.md\` (if they exist)

---

## MCP Tool Permissions

### Session MCP (Orchestrator only)
- Tool prefix: \`mcp__remotelab__*\`
- Source: \`.mcp.json\` in this directory
- Features: create/delete sessions, send messages, labels, tasks, scheduling

### Task MCP (All workspaces)
- Tool prefix: \`mcp__remotelab-tasks__*\`
- Source: Global \`~/.claude/settings.json\`
- Features: create_task / get_task / list_tasks / update_task
- Sub-workspaces only use Task MCP — they don't control sessions

### Orchestration Pattern (Task-first)

**Correct flow:**
1. Create session in target workspace via \`create_session\`
2. Create task via \`create_task\` with \`assigned_session_id\`
3. Send startup message via \`send_message\`
4. Sub-agent completes → calls \`update_task({status: "completed"})\`
5. Dependency chain auto-resolves → next task dispatched

**Anti-patterns to avoid:**
- Sub-workspaces randomly borrowing sessions to send messages
- Circular \`report_to\` references (A→B and B→A)
- Polling dozens of sessions instead of using task dependencies

---

## Orchestrator Rules

- This is the **main workspace** — your direct control center
- Delegate execution to sub-workspaces; keep orchestration here
- Assign models by task difficulty: simple → sonnet, complex/coding → opus
- **Red lines:** No leaking private data; \`trash\` > \`rm\`; confirm before external sends

### Label Protocol

**Core rule: After completing work, label yourself \`pending-review\`.**

Flow:
1. Sub-agent finishes → it labels itself \`pending-review\`
2. You (orchestrator) verify the work
3. If good → label sub-agent \`done\`
4. Report to user → label yourself \`pending-review\`
5. User clears your label after review
AGENTSEOF
print_success "Created AGENTS.md"

# .mcp.json
cat > "$ORCH_DIR/.mcp.json" << MCPEOF
{
  "mcpServers": {
    "remotelab": {
      "command": "node",
      "args": ["$SCRIPT_DIR/mcp-server.mjs"],
      "env": {}
    }
  }
}
MCPEOF
print_success "Created .mcp.json (pointing to $SCRIPT_DIR/mcp-server.mjs)"

# ============================================================
print_header "Step 3: Global Claude Code Settings"

CLAUDE_SETTINGS_DIR="$HOME/.claude"
CLAUDE_SETTINGS_FILE="$CLAUDE_SETTINGS_DIR/settings.json"

print_info "Configuring Task MCP in global Claude Code settings..."

# Create the mcp-task-server if it doesn't exist
MCP_TASK_SERVER="$CLAUDE_SETTINGS_DIR/mcp-task-server.mjs"
if [ ! -f "$MCP_TASK_SERVER" ]; then
    print_warn "mcp-task-server.mjs not found at $MCP_TASK_SERVER"
    print_info "You'll need to copy it from the remotelab installation:"
    print_info "  cp $SCRIPT_DIR/mcp-task-server.mjs $CLAUDE_SETTINGS_DIR/"
    echo ""
fi

# Check if settings.json exists and has remotelab-tasks
if [ -f "$CLAUDE_SETTINGS_FILE" ]; then
    if grep -q "remotelab-tasks" "$CLAUDE_SETTINGS_FILE" 2>/dev/null; then
        print_info "Task MCP already configured in settings.json"
    else
        print_warn "settings.json exists but doesn't have remotelab-tasks MCP"
        print_info "Add this to your ~/.claude/settings.json under mcpServers:"
        echo ""
        echo -e "    ${CYAN}\"remotelab-tasks\": {"
        echo "      \"command\": \"node\","
        echo "      \"args\": [\"$CLAUDE_SETTINGS_DIR/mcp-task-server.mjs\"]"
        echo -e "    }${NC}"
        echo ""
    fi
else
    if ask_yn "Create ~/.claude/settings.json with Task MCP config?" "y"; then
        mkdir -p "$CLAUDE_SETTINGS_DIR"
        cat > "$CLAUDE_SETTINGS_FILE" << SETTINGSEOF
{
  "mcpServers": {
    "remotelab-tasks": {
      "command": "node",
      "args": ["$CLAUDE_SETTINGS_DIR/mcp-task-server.mjs"]
    }
  }
}
SETTINGSEOF
        print_success "Created settings.json with Task MCP"
    fi
fi

# Copy team-templates.json if not present
TEMPLATES_FILE="$CLAUDE_SETTINGS_DIR/team-templates.json"
if [ ! -f "$TEMPLATES_FILE" ]; then
    if [ -f "$SCRIPT_DIR/team-templates.json" ]; then
        print_warn "team-templates.json not found in ~/.claude/"
        if ask_yn "Copy team templates from remotelab?" "y"; then
            cp "$SCRIPT_DIR/team-templates.json" "$TEMPLATES_FILE"
            print_success "Copied team-templates.json"
        fi
    fi
else
    print_info "team-templates.json already exists"
fi

# ============================================================
print_header "Step 4: Sub-Workspaces (Optional)"

echo "  You can add sub-workspaces that the orchestrator will"
echo "  delegate work to. Each gets a minimal CLAUDE.md that"
echo "  points to the shared profile."
echo ""

while ask_yn "Add a sub-workspace?" "n"; do
    SUB_NAME=$(ask "Workspace name (e.g., ResearchCenter)" "")
    SUB_DIR=$(ask "Workspace path" "$HOME/$SUB_NAME")
    SUB_DIR="${SUB_DIR/#\~/$HOME}"

    if [ ! -d "$SUB_DIR" ]; then
        mkdir -p "$SUB_DIR"
        print_success "Created $SUB_DIR"
    fi

    mkdir -p "$SUB_DIR/memory"

    # Minimal CLAUDE.md for sub-workspace
    cat > "$SUB_DIR/CLAUDE.md" << SUBEOF
# $SUB_NAME

## Startup Protocol
1. Read \`~/.huiyuanclaw/USER.md\` (identity)
2. Read \`~/.huiyuanclaw/SOUL.md\` (agent role)
3. Read \`~/.huiyuanclaw/TOOLS.md\` (tools)
4. Read \`memory/\` for recent logs

## Rules
- Use \`mcp__remotelab-tasks__*\` tools to report task progress
- When task is done: \`update_task({status: "completed"})\`
- Do NOT manage sessions — that's the orchestrator's job
SUBEOF

    print_success "Created $SUB_DIR/CLAUDE.md"
    echo ""
done

# ============================================================
print_header "Setup Complete!"

echo "  Your workspace is ready:"
echo ""
echo -e "  ${BOLD}Shared Profile:${NC}     $PROFILE_DIR/"
echo -e "  ${BOLD}Orchestrator:${NC}       $ORCH_DIR/"
echo -e "  ${BOLD}Claude Settings:${NC}    $CLAUDE_SETTINGS_FILE"
echo ""
echo "  Next steps:"
echo ""
echo -e "  ${CYAN}1.${NC} Make sure remotelab is running:"
echo -e "     ${BOLD}remotelab start${NC}"
echo ""
echo -e "  ${CYAN}2.${NC} Open Claude Code in your orchestrator workspace:"
echo -e "     ${BOLD}cd $ORCH_DIR && claude${NC}"
echo ""
echo -e "  ${CYAN}3.${NC} The MCP tools will be available automatically."
echo -e "     Try: \"List all my remotelab sessions\""
echo ""
echo -e "  ${CYAN}4.${NC} Customize your profile in ~/.huiyuanclaw/"
echo -e "     Edit USER.md, SOUL.md, TOOLS.md to match your style."
echo ""
echo -e "  ${GREEN}Happy orchestrating!${NC}"
echo ""
