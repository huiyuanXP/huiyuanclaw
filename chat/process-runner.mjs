import { spawn, execFileSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { resolve, join, extname } from 'path';
import { createInterface } from 'readline';
import { createClaudeAdapter, buildClaudeArgs } from './adapters/claude.mjs';
import { createCodexAdapter, buildCodexArgs } from './adapters/codex.mjs';
import { statusEvent } from './normalizer.mjs';
import { getToolCommand, fullPath } from '../lib/tools.mjs';
import { CHAT_PORT } from '../lib/config.mjs';

/**
 * Build the inline hook settings JSON that routes AskUserQuestion and ExitPlanMode
 * to RemoteLab's internal HTTP endpoint so users can respond via the web UI.
 */
function buildHookSettings(port) {
  return JSON.stringify({
    hooks: {
      PreToolUse: [{
        matcher: 'AskUserQuestion|ExitPlanMode',
        hooks: [{
          type: 'http',
          url: `http://127.0.0.1:${port}/api/internal/hook/pretooluse`,
          timeout: 300,
        }],
      }],
    },
  });
}

function resolveCwd(folder) {
  if (!folder || folder === '~') return homedir();
  if (folder.startsWith('~/')) return join(homedir(), folder.slice(2));
  return resolve(folder);
}

const TAG = '[process-runner]';
const ATTACHMENT_INLINE_TEXT_MAX_BYTES = 128 * 1024;
const ATTACHMENT_INLINE_TEXT_MAX_CHARS = 12000;
const ATTACHMENT_PREVIEW_HEAD_CHARS = 8000;
const ATTACHMENT_PREVIEW_TAIL_CHARS = 2000;
const ATTACHMENT_TRUNCATED_MARKER = '\n[... truncated by RemoteLab attachment preview ...]\n';
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.css', '.csv', '.go', '.h', '.hpp', '.html', '.java', '.js', '.json',
  '.jsx', '.mjs', '.md', '.php', '.py', '.rb', '.rs', '.sh', '.sql', '.svg', '.toml', '.ts',
  '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);

// ---- Global concurrency limiter ----
// Prevents burst API rate limit errors when multiple sessions start simultaneously.
// Configurable via REMOTELAB_MAX_CONCURRENT env var (default: 3).
const MAX_CONCURRENT = parseInt(process.env.REMOTELAB_MAX_CONCURRENT || '3', 10);
let _activeCount = 0;
const _spawnQueue = [];

function _releaseSlot() {
  _activeCount--;
  if (_spawnQueue.length > 0 && _activeCount < MAX_CONCURRENT) {
    const next = _spawnQueue.shift();
    next();
  }
}

function _acquireSlot(doSpawn, onQueued) {
  if (_activeCount < MAX_CONCURRENT) {
    _activeCount++;
    doSpawn();
  } else {
    console.log(`${TAG} Concurrency limit (${MAX_CONCURRENT}) reached — queuing spawn`);
    if (onQueued) onQueued();
    _spawnQueue.push(() => {
      _activeCount++;
      doSpawn();
    });
  }
}

/**
 * Resolve a command name to its full absolute path.
 */
function resolveCommand(cmd) {
  const home = process.env.HOME || '';
  const isMac = process.platform === 'darwin';
  try {
    const resolved = execFileSync('which', [cmd], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fullPath },
      timeout: 3000,
    }).trim();
    console.log(`${TAG} Resolved "${cmd}" → ${resolved} (which)`);
    return resolved;
  } catch {
    const preferred = [
      `${home}/.local/bin/${cmd}`,
      ...(isMac ? [
        `${home}/Library/pnpm/${cmd}`,
        `/opt/homebrew/bin/${cmd}`,
      ] : [
        `/snap/bin/${cmd}`,
      ]),
      `/usr/local/bin/${cmd}`,
      `/usr/bin/${cmd}`,
    ];
    for (const p of preferred) {
      if (p && existsSync(p)) {
        console.log(`${TAG} Resolved "${cmd}" → ${p} (fallback path)`);
        return p;
      }
    }
    console.log(`${TAG} Could not resolve "${cmd}", using bare name`);
    return cmd;
  }
}

function clipAttachmentText(text) {
  if (!text) return '';
  if (text.length <= ATTACHMENT_INLINE_TEXT_MAX_CHARS) return text;
  return `${text.slice(0, ATTACHMENT_PREVIEW_HEAD_CHARS).trimEnd()}${ATTACHMENT_TRUNCATED_MARKER}${text.slice(-ATTACHMENT_PREVIEW_TAIL_CHARS).trimStart()}`;
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.length === 0) return false;
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  const decoded = sample.toString('utf8');
  const replacementCount = [...decoded].filter((char) => char === '\uFFFD').length;
  return replacementCount > 0 && replacementCount / Math.max(decoded.length, 1) > 0.02;
}

function isTextLikeAttachment(attachment, filepath) {
  const mimeType = typeof attachment?.mimeType === 'string' ? attachment.mimeType.toLowerCase() : '';
  if (mimeType.startsWith('text/')) return true;
  if ([
    'application/json',
    'application/ld+json',
    'application/javascript',
    'application/typescript',
    'application/xml',
    'image/svg+xml',
  ].includes(mimeType)) return true;
  return TEXT_ATTACHMENT_EXTENSIONS.has(extname(filepath || '').toLowerCase());
}

function buildAttachmentPromptSection(attachment) {
  const filepath = attachment?.savedPath;
  if (!filepath || !existsSync(filepath)) return '';
  const displayName = attachment.originalName || attachment.filename || 'attachment';
  const mimeType = attachment.mimeType || 'application/octet-stream';
  const label = mimeType.startsWith('image/') ? 'image' : 'file';
  const metaLines = [
    `[User attached ${label}: ${displayName} -> ${filepath}]`,
    `- MIME type: ${mimeType}`,
  ];

  try {
    const sizeBytes = statSync(filepath).size;
    metaLines.push(`- Size: ${sizeBytes} bytes`);
    if (!isTextLikeAttachment(attachment, filepath)) {
      metaLines.push('- Note: binary or non-text attachment; inspect the file path directly if needed.');
      return metaLines.join('\n');
    }
    if (sizeBytes > ATTACHMENT_INLINE_TEXT_MAX_BYTES) {
      metaLines.push(`- Note: text-like attachment exceeds ${ATTACHMENT_INLINE_TEXT_MAX_BYTES} bytes; inspect the file path directly if you need the full content.`);
      return metaLines.join('\n');
    }
    const raw = readFileSync(filepath);
    if (looksBinary(raw)) {
      metaLines.push('- Note: attachment appears binary despite its extension; inspect the file path directly if needed.');
      return metaLines.join('\n');
    }
    const text = clipAttachmentText(raw.toString('utf8').replace(/\r\n/g, '\n').trim());
    if (!text) {
      metaLines.push('- Note: attachment is empty.');
      return metaLines.join('\n');
    }
    return [
      ...metaLines,
      '- RemoteLab extracted a preview below so you can use the file without first opening it manually.',
      `--- BEGIN ATTACHMENT PREVIEW: ${displayName} ---`,
      text,
      `--- END ATTACHMENT PREVIEW: ${displayName} ---`,
    ].join('\n');
  } catch (error) {
    metaLines.push(`- Note: failed to read attachment preview (${error.message || error}); inspect the file path directly if needed.`);
    return metaLines.join('\n');
  }
}

export function prependAttachmentPaths(prompt, attachments) {
  const sections = (attachments || [])
    .filter((attachment) => attachment?.savedPath)
    .map((attachment) => buildAttachmentPromptSection(attachment))
    .filter(Boolean);
  if (sections.length === 0) return prompt;
  const attachmentInstructions = [
    '[RemoteLab attachment context]',
    'Use the attachment metadata and previews below as part of the user request.',
    'If a preview is truncated or omitted, read the file from its saved path before answering.',
    '',
    sections.join('\n\n'),
  ].join('\n');
  return `${attachmentInstructions}\n\n${prompt}`;
}

/**
 * Max number of auto-continue attempts for Codex when a turn ends
 * but the last agent message indicates unfinished work.
 */
const CODEX_MAX_AUTO_CONTINUES = 3;

/**
 * Patterns in the last agent_message that suggest Codex planned work
 * but didn't actually execute it before ending the turn.
 */
const CODEX_UNFINISHED_PATTERNS = [
  /\bi(?:'ll|'ll| will)\b/i,
  /\bnext\b.*\b(?:i'll|let me|we'll)\b/i,
  /\bnow\b.*\b(?:i'll|let me)\b/i,
  /\blet me\b/i,
  /\bgoing to\b/i,
];

/**
 * Check whether the last agent message from Codex suggests it planned
 * further work but the turn ended before executing it.
 */
function codexTurnLooksIncomplete(lastAgentMessage, hadFileChanges, hadCommands) {
  if (!lastAgentMessage) return false;
  // If the turn actually produced file changes or multiple commands, it did real work
  if (hadFileChanges) return false;
  if (hadCommands >= 2) return false;
  // Check if the last message promises future actions
  return CODEX_UNFINISHED_PATTERNS.some(p => p.test(lastAgentMessage));
}

export function spawnTool(toolId, folder, prompt, onEvent, onExit, options = {}) {
  const command = getToolCommand(toolId);
  const isClaudeFamily = ['claude'].includes(toolId);
  const isCodexFamily = ['codex'].includes(toolId);
  const hasAttachments = options.attachments && options.attachments.length > 0;
  const resolvedFolder = resolveCwd(folder);

  const effectivePrompt = hasAttachments ? prependAttachmentPaths(prompt, options.attachments) : prompt;

  let adapter;
  let args;

  if (isClaudeFamily) {
    adapter = createClaudeAdapter({ prompt });
    args = buildClaudeArgs(effectivePrompt, {
      dangerouslySkipPermissions: true,
      resume: options.claudeSessionId,
      thinking: options.thinking,
      model: options.model,
      folder: resolvedFolder,
      hookSettingsJson: buildHookSettings(CHAT_PORT),
    });
  } else if (isCodexFamily) {
    adapter = createCodexAdapter({ prompt });
    args = buildCodexArgs(effectivePrompt, {
      threadId: options.codexThreadId,
      model: options.model,
      folder: resolvedFolder,
    });
  } else {
    adapter = createClaudeAdapter({ prompt });
    args = buildClaudeArgs(effectivePrompt, {
      dangerouslySkipPermissions: true,
      thinking: options.thinking,
      folder: resolvedFolder,
    });
  }

  const resolvedCmd = resolveCommand(command);

  // Clean env: remove CLAUDECODE markers so nested Claude Code sessions work
  const cleanEnv = { ...process.env, PATH: fullPath };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
  if (options.sessionId) cleanEnv.REMOTELAB_SESSION_ID = options.sessionId;

  // Shared mutable state across potential auto-continue cycles
  const state = {
    proc: null,
    capturedClaudeSessionId: null,
    capturedCodexThreadId: null,
    cancelled: false,
    queued: false,
    exitCalled: false,
    slotReleased: false,
    autoContinueCount: 0,
  };

  function safeOnExit(code) {
    if (state.exitCalled) return;
    state.exitCalled = true;
    onExit(code);
  }

  function releaseSlotOnce() {
    if (state.slotReleased) return;
    state.slotReleased = true;
    _releaseSlot();
  }

  function spawnProcess(spawnArgs) {
    const spawnStart = Date.now();
    console.log(`${TAG} Spawning: ${resolvedCmd}`);
    console.log(`${TAG}   args: ${JSON.stringify(spawnArgs)}`);
    console.log(`${TAG}   cwd: ${folder} → ${resolvedFolder}`);
    console.log(`${TAG}   prompt: ${prompt?.slice(0, 100)}`);
    if (hasAttachments) console.log(`${TAG}   attachments: ${options.attachments.length}`);
    const hasResume = spawnArgs.includes('--resume');
    if (hasResume) {
      const resumeIdx = spawnArgs.indexOf('--resume');
      console.log(`${TAG}   resume: ${spawnArgs[resumeIdx + 1]}`);
    }

    const proc = spawn(resolvedCmd, spawnArgs, {
      cwd: resolvedFolder,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv,
    });
    state.proc = proc;

    console.log(`${TAG} Process spawned, pid=${proc.pid} (+${Date.now() - spawnStart}ms)`);

    // Emit a UI status event so user sees progress immediately
    onEvent(statusEvent(hasResume ? 'Resuming session...' : 'Starting CLI...'));

    // Periodic "still waiting" log + UI status if no stdout received
    let gotFirstOutput = false;
    const waitTimer = setInterval(() => {
      if (!gotFirstOutput) {
        const elapsed = Math.round((Date.now() - spawnStart) / 1000);
        console.log(`${TAG} Still waiting for first output from pid=${proc.pid} (${elapsed}s elapsed)`);
        onEvent(statusEvent(`Waiting for CLI response... (${elapsed}s)`));
      }
    }, 5000);

    const rl = createInterface({ input: proc.stdout });
    let lineCount = 0;

    // Track Codex turn content for auto-continue detection
    let lastAgentMessage = null;
    let turnFileChanges = 0;
    let turnCommands = 0;

    rl.on('line', (line) => {
      lineCount++;
      if (!gotFirstOutput) {
        gotFirstOutput = true;
        clearInterval(waitTimer);
        const elapsed = ((Date.now() - spawnStart) / 1000).toFixed(1);
        console.log(`${TAG} First output after ${elapsed}s from pid=${proc.pid}`);
      }
      console.log(`${TAG} [stdout#${lineCount}] ${line.slice(0, 300)}`);

      // Capture session/thread IDs for conversation resumption
      try {
        const obj = JSON.parse(line);
        // Only capture session_id from the system.init event (the conversation session).
        // hook_started events carry a different, ephemeral process-level session_id
        // that has no backing JSONL file and cannot be used with --resume.
        if (isClaudeFamily && !state.capturedClaudeSessionId
            && obj.type === 'system' && obj.subtype === 'init' && obj.session_id) {
          state.capturedClaudeSessionId = obj.session_id;
          console.log(`${TAG} Captured Claude session_id: ${state.capturedClaudeSessionId}`);
          if (options.onClaudeSessionId) {
            options.onClaudeSessionId(state.capturedClaudeSessionId);
          }
        }
        if (isCodexFamily && !state.capturedCodexThreadId && obj.type === 'thread.started' && obj.thread_id) {
          state.capturedCodexThreadId = obj.thread_id;
          console.log(`${TAG} Captured Codex thread_id: ${state.capturedCodexThreadId}`);
        }

        // Track what this turn actually did
        if (isCodexFamily && obj.type === 'item.completed' && obj.item) {
          if (obj.item.type === 'agent_message') lastAgentMessage = obj.item.text || '';
          if (obj.item.type === 'file_change') turnFileChanges++;
          if (obj.item.type === 'command_execution') turnCommands++;
        }
      } catch {}

      const events = adapter.parseLine(line);
      console.log(`${TAG}   → parsed ${events.length} event(s): ${events.map(e => e.type).join(', ') || '(none)'}`);
      for (const evt of events) {
        onEvent(evt);
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) {
        const elapsed = ((Date.now() - spawnStart) / 1000).toFixed(1);
        console.log(`${TAG} [stderr +${elapsed}s] ${text.slice(0, 500)}`);
      }
    });

    proc.on('error', (err) => {
      clearInterval(waitTimer);
      console.error(`${TAG} Process error: ${err.message} (code=${err.code})`);
      onEvent(statusEvent(`process error: ${err.message}`));
      releaseSlotOnce();
      safeOnExit(1);
    });

    proc.on('exit', (code, signal) => {
      clearInterval(waitTimer);
      const totalSec = ((Date.now() - spawnStart) / 1000).toFixed(1);
      console.log(`${TAG} Process exited: code=${code}, signal=${signal}, lines=${lineCount}, total=${totalSec}s`);
      const remaining = adapter.flush();
      if (remaining.length > 0) {
        console.log(`${TAG} Flushed ${remaining.length} remaining event(s)`);
        for (const evt of remaining) {
          onEvent(evt);
        }
      }

      // Codex auto-continue: if the turn ended cleanly but work looks incomplete,
      // automatically resume with a "continue" prompt.
      if (
        isCodexFamily &&
        !state.cancelled &&
        code === 0 &&
        state.capturedCodexThreadId &&
        state.autoContinueCount < CODEX_MAX_AUTO_CONTINUES &&
        codexTurnLooksIncomplete(lastAgentMessage, turnFileChanges, turnCommands)
      ) {
        state.autoContinueCount++;
        console.log(`${TAG} Codex turn looks incomplete (attempt ${state.autoContinueCount}/${CODEX_MAX_AUTO_CONTINUES}), auto-continuing...`);
        console.log(`${TAG}   lastMsg: "${lastAgentMessage?.slice(0, 120)}"`);
        console.log(`${TAG}   fileChanges=${turnFileChanges}, commands=${turnCommands}`);

        onEvent(statusEvent(`auto-continuing (${state.autoContinueCount}/${CODEX_MAX_AUTO_CONTINUES})...`));

        const continueArgs = buildCodexArgs('Continue. Complete all remaining work now.', {
          threadId: state.capturedCodexThreadId,
          folder: resolvedFolder,
        });
        spawnProcess(continueArgs);
        return;
      }

      releaseSlotOnce();
      safeOnExit(code ?? 1);
    });

    proc.stdin.end();
  }

  // Initial spawn — go through concurrency limiter.
  // If cancelled while queued, the entry checks state.cancelled and skips spawning.
  state.queued = false;
  _acquireSlot(
    () => {
      state.queued = false;
      if (state.cancelled) {
        // Was cancelled while waiting in queue — release slot and bail
        _releaseSlot();
        safeOnExit(1);
        return;
      }
      spawnProcess(args);
    },
    () => {
      state.queued = true;
      onEvent(statusEvent('Queued — waiting for available API slot...'));
    },
  );

  return {
    get proc() { return state.proc; },
    toolId,
    get claudeSessionId() { return state.capturedClaudeSessionId; },
    get codexThreadId() { return state.capturedCodexThreadId; },
    cancel() {
      state.cancelled = true;
      if (state.queued) {
        // Still in queue — notify exit immediately; queue entry will self-skip via state.cancelled
        state.queued = false;
        safeOnExit(1);
        return;
      }
      console.log(`${TAG} Killing process pid=${state.proc?.pid}`);
      try {
        state.proc?.kill('SIGTERM');
      } catch {}
    },
  };
}
