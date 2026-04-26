import { spawn, execFileSync } from 'child_process';
import { createInterface } from 'readline';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { homedir } from 'os';
import { join } from 'path';
import { SIDEBAR_STATE_FILE } from '../lib/config.mjs';
import { loadHistory } from './history.mjs';
import { fullPath, getToolCommand } from '../lib/tools.mjs';
import { getChatSettings } from '../lib/runtime-settings.mjs';
import { createClaudeAdapter } from './adapters/claude.mjs';
import { createCodexAdapter } from './adapters/codex.mjs';

function resolveClaudeCmd() {
  const home = process.env.HOME || homedir();
  const isMac = process.platform === 'darwin';
  const preferred = [
    join(home, '.local', 'bin', 'claude'),
    // macOS-specific paths
    ...(isMac ? [
      join(home, 'Library', 'pnpm', 'claude'),
      '/opt/homebrew/bin/claude',
    ] : [
      // Linux-specific paths
      '/snap/bin/claude',
    ]),
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ];
  for (const p of preferred) {
    if (existsSync(p)) return p;
  }
  try {
    return execFileSync('which', ['claude'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fullPath },
      timeout: 3000,
    }).trim();
  } catch {
    return 'claude';
  }
}

function resolveToolCmd(toolId) {
  const toolCommand = getToolCommand(toolId || 'claude');
  const home = process.env.HOME || homedir();
  const isMac = process.platform === 'darwin';
  const preferred = [
    join(home, '.local', 'bin', toolCommand),
    ...(isMac ? [
      join(home, 'Library', 'pnpm', toolCommand),
      '/opt/homebrew/bin/' + toolCommand,
    ] : [
      '/snap/bin/' + toolCommand,
    ]),
    '/usr/local/bin/' + toolCommand,
    '/usr/bin/' + toolCommand,
  ];
  for (const p of preferred) {
    if (existsSync(p)) return p;
  }
  try {
    return execFileSync('which', [toolCommand], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fullPath },
      timeout: 3000,
    }).trim();
  } catch {
    return toolCommand;
  }
}

function getConfiguredModel(toolId, fallbackModel = '') {
  const chatSettings = getChatSettings();
  if (toolId === 'claude') {
    return chatSettings.claudeModel || fallbackModel || 'sonnet';
  }
  return chatSettings.codexModel || fallbackModel || 'gpt-5.4';
}

async function runPromptOnce(prompt, {
  tool = 'codex',
  model,
  timeout = 30000,
  suppressStderr = false,
  logLabel = 'prompt',
} = {}) {
  const resolvedCmd = resolveToolCmd(tool);
  const isCodex = tool === 'codex';
  const subEnv = { ...process.env, PATH: fullPath };
  delete subEnv.CLAUDECODE;
  delete subEnv.CLAUDE_CODE_ENTRYPOINT;

  return new Promise((resolve, reject) => {
    const args = isCodex
      ? ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', ...(model ? ['--model', model] : []), prompt]
      : ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', ...(model ? ['--model', model] : [])];
    const proc = spawn(resolvedCmd, args, {
      env: subEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stdin.end();

    const adapter = isCodex ? createCodexAdapter({ prompt }) : createClaudeAdapter({ prompt });
    const rl = createInterface({ input: proc.stdout });
    const textParts = [];

    rl.on('line', (line) => {
      const events = adapter.parseLine(line);
      for (const evt of events) {
        if (evt.type === 'message' && evt.role === 'assistant') {
          textParts.push(evt.content || '');
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      if (suppressStderr) return;
      const text = chunk.toString().trim();
      if (text) console.log(`[summarizer] ${logLabel} stderr: ${text.slice(0, 200)}`);
    });

    proc.on('error', reject);
    proc.on('exit', (code) => {
      const remaining = adapter.flush();
      for (const evt of remaining) {
        if (evt.type === 'message' && evt.role === 'assistant') textParts.push(evt.content || '');
      }
      const output = textParts.join('').trim();
      if (!output && code !== 0) {
        reject(new Error(`${tool} exited with code ${code}`));
        return;
      }
      resolve(output);
    });

    setTimeout(() => {
      try { proc.kill(); } catch {}
    }, timeout);
  });
}

function loadSidebarState() {
  try {
    if (!existsSync(SIDEBAR_STATE_FILE)) return { sessions: {} };
    return JSON.parse(readFileSync(SIDEBAR_STATE_FILE, 'utf8'));
  } catch {
    return { sessions: {} };
  }
}

function saveSidebarState(state) {
  const dir = dirname(SIDEBAR_STATE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SIDEBAR_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Extract events belonging to the last turn (from the last user message onward).
 */
function extractLastTurn(events) {
  let lastUserIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'message' && events[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  return lastUserIdx === -1 ? events : events.slice(lastUserIdx);
}

/**
 * Format the last turn's events into a concise text block for the LLM prompt.
 * Skips reasoning/usage/status noise, caps lengths to keep context bounded.
 */
function formatTurnForPrompt(events) {
  const lines = [];
  for (const evt of events) {
    switch (evt.type) {
      case 'message':
        if (evt.role === 'user') {
          lines.push(`USER: ${(evt.content || '').slice(0, 400)}`);
        } else if (evt.role === 'assistant') {
          lines.push(`ASSISTANT: ${(evt.content || '').slice(0, 600)}`);
        }
        break;
      case 'file_change':
        lines.push(`FILE ${(evt.changeType || 'changed').toUpperCase()}: ${evt.filePath}`);
        break;
      case 'tool_use':
        lines.push(`TOOL CALLED: ${evt.toolName}`);
        break;
    }
  }
  return lines.join('\n');
}

/**
 * Trigger a non-blocking summary generation after a session turn completes.
 * sessionMeta: { id, folder, name }
 */
export function triggerSummary(sessionMeta) {
  console.log(`[summarizer] triggerSummary called for session ${sessionMeta.id?.slice(0, 8)}`);
  setImmediate(() => runSummary(sessionMeta).catch(err => {
    console.error(`[summarizer] Unexpected error for ${sessionMeta.id?.slice(0, 8)}: ${err.message}`);
  }));
}

async function runSummary(sessionMeta) {
  const { id: sessionId, folder, name } = sessionMeta;

  const allEvents = loadHistory(sessionId);
  if (allEvents.length === 0) {
    console.log(`[summarizer] Skipping ${sessionId.slice(0, 8)}: no history events`);
    return;
  }

  const lastTurnEvents = extractLastTurn(allEvents);
  const turnText = formatTurnForPrompt(lastTurnEvents);
  if (!turnText.trim()) {
    console.log(`[summarizer] Skipping ${sessionId.slice(0, 8)}: empty turn text (${lastTurnEvents.length} events)`);
    return;
  }

  const state = loadSidebarState();
  const prevBackground = state.sessions[sessionId]?.background || '';

  const prompt = [
    'You are updating a developer\'s session status board. Be extremely concise.',
    '',
    `Session folder: ${folder}`,
    `Session name: ${name || '(unnamed)'}`,
    prevBackground ? `Previous background: ${prevBackground}` : '',
    '',
    'Last turn:',
    turnText,
    '',
    'Write a JSON object with exactly these two fields:',
    '- "background": One sentence — what is this session working on overall? Update if this turn changes the focus.',
    '- "lastAction": One sentence — the single most important thing that just happened.',
    '',
    'Respond with ONLY valid JSON. No markdown, no explanation.',
  ].filter(l => l !== null).join('\n');

  const chatSettings = getChatSettings();
  const tool = chatSettings.defaultTool || 'codex';
  const model = getConfiguredModel(tool);
  const modelText = await runPromptOnce(prompt, {
    tool,
    model,
    timeout: 30000,
    logLabel: `sidebar ${sessionId.slice(0, 8)}`,
  });

  // The model text itself should be a JSON object
  let summary;
  try {
    summary = JSON.parse(modelText);
  } catch {
    // Try to extract JSON from the text if wrapped in backticks or similar
    const jsonMatch = modelText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { summary = JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
    }
  }

  if (!summary?.background || !summary?.lastAction) {
    console.error(`[summarizer] Unexpected model output for ${sessionId.slice(0, 8)}: ${modelText.slice(0, 200)}`);
    return;
  }

  state.sessions[sessionId] = {
    name: name || '',
    folder,
    background: summary.background,
    lastAction: summary.lastAction,
    updatedAt: Date.now(),
  };
  saveSidebarState(state);
  console.log(`[summarizer] Updated sidebar for session ${sessionId.slice(0, 8)}: ${summary.lastAction}`);
}

export function getSidebarState() {
  return loadSidebarState();
}

/**
 * Generate a comprehensive conversation summary for context compaction.
 * Returns the summary text string.
 */
export async function generateCompactSummary(sessionId, folder) {
  const allEvents = loadHistory(sessionId);
  if (allEvents.length === 0) throw new Error('No history to summarize');

  const lines = [];
  for (const evt of allEvents) {
    switch (evt.type) {
      case 'message':
        if (evt.role === 'user') {
          lines.push(`USER: ${(evt.content || '').slice(0, 300)}`);
        } else if (evt.role === 'assistant') {
          lines.push(`ASSISTANT: ${(evt.content || '').slice(0, 500)}`);
        }
        break;
      case 'file_change':
        lines.push(`FILE ${(evt.changeType || 'changed').toUpperCase()}: ${evt.filePath}`);
        break;
      case 'tool_use':
        lines.push(`TOOL: ${evt.toolName}`);
        break;
    }
  }

  // Cap the formatted history to ~40K chars to stay within prompt limits
  let historyText = lines.join('\n');
  if (historyText.length > 40000) {
    historyText = historyText.slice(-40000);
  }

  const prompt = [
    'You are summarizing a coding conversation for context transfer.',
    `The conversation happened in folder: ${folder}`,
    '',
    'Full conversation:',
    historyText,
    '',
    'Create a comprehensive summary that includes:',
    '1. OBJECTIVE: What the user is trying to accomplish',
    '2. PROGRESS: What has been done so far (files created/modified, key decisions)',
    '3. CURRENT STATE: Where things stand right now',
    '4. NEXT STEPS: What was being worked on or planned next',
    '5. KEY FILES: Important files that were created or modified (with paths)',
    '6. IMPORTANT CONTEXT: Any constraints, preferences, or decisions the user expressed',
    '',
    'Be thorough but concise. This summary will be used to continue the conversation in a new context window.',
  ].join('\n');

  const chatSettings = getChatSettings();
  const tool = chatSettings.defaultTool || 'codex';
  const model = getConfiguredModel(tool);
  return runPromptOnce(prompt, {
    tool,
    model,
    timeout: 45000,
    logLabel: `compact ${sessionId.slice(0, 8)}`,
  });
}

/**
 * Generate a short title for a session based on the user's first message.
 * Returns the title string, or null on failure.
 */
export async function generateAutoTitle(userMessage) {
  const prompt = [
    'Generate a short title (3-8 words, no quotes) for a coding session based on this user message:',
    '',
    userMessage.slice(0, 500),
    '',
    'Reply with ONLY the title text, nothing else.',
  ].join('\n');
  const chatSettings = getChatSettings();
  const namingTool = chatSettings.namingTool || 'codex';
  const namingModel = chatSettings.namingModel || (namingTool === 'codex' ? 'gpt-5.4-mini' : 'haiku');

  try {
    const modelText = await runPromptOnce(prompt, {
      tool: namingTool,
      model: namingModel,
      timeout: 30000,
      suppressStderr: true,
      logLabel: 'auto-title',
    });

    const title = modelText.replace(/^["']|["']$/g, '').trim();
    if (title && title.length > 0 && title.length < 100) {
      return title;
    }
    console.error(`[summarizer] Auto-title bad output: ${modelText.slice(0, 100)}`);
    return null;
  } catch (err) {
    console.error(`[summarizer] Auto-title failed: ${err.message}`);
    return null;
  }
}

/**
 * Lightweight one-shot model call used for conflict checks and classification.
 */
export async function callHaiku(prompt, { timeout = 30000 } = {}) {
  const chatSettings = getChatSettings();
  const lightweightTool = chatSettings.namingTool || 'codex';
  const lightweightModel = chatSettings.namingModel
    || (lightweightTool === 'codex' ? 'gpt-5.4-mini' : 'haiku');

  try {
    const modelText = await runPromptOnce(prompt, {
      tool: lightweightTool,
      model: lightweightModel,
      timeout,
      suppressStderr: true,
      logLabel: 'lightweight',
    });
    return modelText.trim() || null;
  } catch (err) {
    console.error(`[summarizer] callHaiku failed: ${err.message}`);
    return null;
  }
}

export function removeSidebarEntry(sessionId) {
  const state = loadSidebarState();
  if (state.sessions[sessionId]) {
    delete state.sessions[sessionId];
    saveSidebarState(state);
  }
}
