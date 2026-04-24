import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, statSync, readdirSync, unlinkSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { CHAT_SESSIONS_FILE, CHAT_IMAGES_DIR, INTERRUPTED_SESSIONS_FILE, SESSION_LABELS_FILE } from '../lib/config.mjs';
import { spawnTool } from './process-runner.mjs';
import { loadHistory, appendEvent } from './history.mjs';
import { messageEvent, statusEvent, compactEvent, restartInterruptEvent, restartResumeEvent, systemNotificationEvent } from './normalizer.mjs';
import { triggerSummary, removeSidebarEntry, generateCompactSummary, generateAutoTitle, callHaiku } from './summarizer.mjs';

const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

/**
 * Save base64 images to disk and return image metadata with file paths.
 */
function saveImages(images) {
  if (!images || images.length === 0) return [];
  if (!existsSync(CHAT_IMAGES_DIR)) mkdirSync(CHAT_IMAGES_DIR, { recursive: true });
  return images.map(img => {
    const ext = MIME_EXT[img.mimeType] || '.png';
    const filename = randomBytes(12).toString('hex') + ext;
    const filepath = join(CHAT_IMAGES_DIR, filename);
    writeFileSync(filepath, Buffer.from(img.data, 'base64'));
    return { filename, savedPath: filepath, mimeType: img.mimeType || 'image/png', data: img.data };
  });
}

function sanitizeAttachmentName(rawName = 'attachment') {
  const normalized = basename(String(rawName || 'attachment').replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return normalized.slice(0, 255) || 'attachment';
}

function saveAttachments(session, attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  const uploadDir = join(session.folder, 'shared');
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

  return attachments.map((attachment) => {
    const originalName = sanitizeAttachmentName(attachment.originalName || attachment.filename || 'attachment');
    const isInlineImage = typeof attachment.mimeType === 'string' && attachment.mimeType.startsWith('image/');

    if (attachment.savedPath && existsSync(attachment.savedPath)) {
      const filename = sanitizeAttachmentName(attachment.filename || `${randomBytes(6).toString('hex')}-${originalName}`);
      const finalPath = join(uploadDir, filename);
      if (resolve(attachment.savedPath) !== resolve(finalPath)) {
        writeFileSync(finalPath, readFileSync(attachment.savedPath));
      }
      return {
        filename,
        originalName,
        savedPath: finalPath,
        mimeType: attachment.mimeType || 'application/octet-stream',
        sizeBytes: statSync(finalPath).size,
        ...(attachment.renderAs ? { renderAs: attachment.renderAs } : {}),
      };
    }

    if (attachment.filename) {
      const filename = sanitizeAttachmentName(attachment.filename || originalName);
      const existingPath = join(uploadDir, filename);
      if (existsSync(existingPath)) {
        return {
          filename,
          originalName,
          savedPath: existingPath,
          mimeType: attachment.mimeType || 'application/octet-stream',
          sizeBytes: statSync(existingPath).size,
          ...(attachment.renderAs ? { renderAs: attachment.renderAs } : {}),
        };
      }
    }

    const ext = isInlineImage ? (MIME_EXT[attachment.mimeType] || '.png') : '';
    const fallbackName = isInlineImage
      ? `${randomBytes(12).toString('hex')}${ext}`
      : `${randomBytes(6).toString('hex')}-${originalName}`;
    const filename = sanitizeAttachmentName(attachment.filename || fallbackName);
    const filepath = join(uploadDir, filename);

    if (attachment.data) {
      writeFileSync(filepath, Buffer.from(attachment.data, 'base64'));
    } else if (Buffer.isBuffer(attachment.buffer)) {
      writeFileSync(filepath, attachment.buffer);
    } else {
      throw new Error(`Attachment data missing for ${originalName}`);
    }

    return {
      filename,
      originalName,
      savedPath: filepath,
      mimeType: attachment.mimeType || (isInlineImage ? 'image/png' : 'application/octet-stream'),
      sizeBytes: statSync(filepath).size,
      ...(attachment.renderAs ? { renderAs: attachment.renderAs } : {}),
    };
  });
}

function toClientAttachment(sessionId, attachment) {
  const filename = attachment.filename;
  return {
    filename,
    originalName: attachment.originalName || filename,
    mimeType: attachment.mimeType || 'application/octet-stream',
    downloadUrl: `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(filename)}?download=1`,
    url: `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(filename)}`,
    ...(Number.isFinite(attachment.sizeBytes) ? { sizeBytes: attachment.sizeBytes } : {}),
    ...(attachment.renderAs ? { renderAs: attachment.renderAs } : {}),
  };
}

// In-memory session registry
// sessionId -> {
//   status,
//   runner,
//   listeners: Set<ws>,
//   claudeSessionId,
//   codexThreadId,
//   followUpQueue: Array<queuedFollowUp>
// }
const liveSessions = new Map();

// Global subscribers: WS clients that receive system-level events
// (session created, deleted, status changes) regardless of which session they're attached to.
const globalSubscribers = new Set();

export function subscribeGlobal(ws) {
  globalSubscribers.add(ws);
}

export function unsubscribeGlobal(ws) {
  globalSubscribers.delete(ws);
}

function broadcastGlobal(msg) {
  const data = JSON.stringify(msg);
  for (const ws of globalSubscribers) {
    try {
      if (ws.readyState === 1) ws.send(data);
    } catch {}
  }
}

/**
 * Broadcast a report:new event to all connected WebSocket clients.
 */
export function broadcastReportNew(report) {
  broadcastGlobal({ type: 'report:new', report });
}

// Maps Claude's internal session_id → RemoteLab sessionId (for hook routing)
const claudeSessionMap = new Map();

// Pending PreToolUse hook requests: remoteLabSessionId → { resolve, reject, toolName, toolInput }
const pendingHooks = new Map();

// Completion waiters: sessionId → [{ resolve, reject }]
// Used by waitForIdle() / createAndRun() to block until a session finishes running.
const completionWaiters = new Map();

function generateId() {
  return randomBytes(16).toString('hex');
}

function createLiveSessionState(meta = {}) {
  return {
    status: 'idle',
    runner: null,
    listeners: new Set(),
    claudeSessionId: meta?.claudeSessionId,
    codexThreadId: meta?.codexThreadId,
    followUpQueue: [],
  };
}

function getQueuedMessageCount(sessionId) {
  const live = liveSessions.get(sessionId);
  return Array.isArray(live?.followUpQueue) ? live.followUpQueue.length : 0;
}

function getQueuedMessages(sessionId) {
  const live = liveSessions.get(sessionId);
  const queue = Array.isArray(live?.followUpQueue) ? live.followUpQueue : [];
  return queue.map((entry, index) => {
    const attachments = Array.isArray(entry?.attachments)
      ? entry.attachments.map((attachment) => toClientAttachment(sessionId, attachment))
      : [];
    return {
      id: entry?.id || `${sessionId}-queued-${index + 1}`,
      text: typeof entry?.text === 'string' ? entry.text : '',
      attachments,
      isSystemNotification: entry?.isSystemNotification === true,
      queuedAt: entry?.queuedAt || new Date().toISOString(),
      order: index + 1,
    };
  });
}

function buildSessionPayload(session, statusOverride) {
  if (!session) return null;
  const live = liveSessions.get(session.id);
  const status = statusOverride || live?.status || 'idle';
  const queuedMessages = getQueuedMessages(session.id);
  const queuedMessageCount = queuedMessages.length;
  return {
    ...session,
    status,
    queuedMessageCount,
    queuedMessages,
  };
}

function enqueueFollowUp(sessionId, entry) {
  const live = liveSessions.get(sessionId);
  if (!live) return 0;
  if (!Array.isArray(live.followUpQueue)) {
    live.followUpQueue = [];
  }
  live.followUpQueue.push({
    ...entry,
    id: entry?.id || generateId(),
    queuedAt: entry?.queuedAt || new Date().toISOString(),
  });
  return live.followUpQueue.length;
}

function resolveQueuedFollowUpDispatchOptions(queue, session) {
  const resolved = {
    tool: session?.tool || '',
    model: session?.model,
    thinking: false,
  };
  for (const entry of queue || []) {
    if (typeof entry?.tool === 'string' && entry.tool.trim()) {
      resolved.tool = entry.tool.trim();
    }
    if (typeof entry?.model === 'string' && entry.model.trim()) {
      resolved.model = entry.model.trim();
    }
    if (entry?.thinking === true) {
      resolved.thinking = true;
    }
  }
  return resolved;
}

function buildQueuedFollowUpDispatchText(queue = []) {
  if (!Array.isArray(queue) || queue.length === 0) return '';
  if (queue.length === 1) {
    return String(queue[0]?.text || '').trim();
  }
  return [
    'Queued follow-up messages sent while RemoteLab was busy:',
    '',
    ...queue.map((entry, index) => `${index + 1}. ${String(entry?.text || '').trim()}`),
    '',
    'Treat the ordered items above as the next user turn. If a later item overrides an earlier one, follow the latest correction.',
  ].join('\n');
}

// ---- Hook IPC (PreToolUse HTTP bridge for AskUserQuestion / ExitPlanMode) ----

export function registerClaudeSession(claudeSessionId, remoteLabSessionId) {
  claudeSessionMap.set(claudeSessionId, remoteLabSessionId);
}

export function unregisterClaudeSession(claudeSessionId) {
  claudeSessionMap.delete(claudeSessionId);
}

/**
 * Called by the HTTP hook endpoint when Claude fires a PreToolUse event.
 * Returns a Promise that resolves when the user responds via hook_response WebSocket action.
 * Rejects after timeout or if the session ends.
 */
export function receiveHookRequest(claudeSessionId, toolName, toolInput) {
  const remoteLabSessionId = claudeSessionMap.get(claudeSessionId);
  if (!remoteLabSessionId) {
    return Promise.reject(new Error(`No RemoteLab session mapped for Claude session ${claudeSessionId}`));
  }
  return new Promise((resolve, reject) => {
    pendingHooks.set(remoteLabSessionId, { resolve, reject, toolName, toolInput });
  });
}

/**
 * Called from ws.mjs when user sends a hook_response action.
 * Returns true if a pending hook was found and resolved, false otherwise.
 */
export function resolveHookRequest(remoteLabSessionId, msg) {
  const pending = pendingHooks.get(remoteLabSessionId);
  if (!pending) return false;
  pendingHooks.delete(remoteLabSessionId);
  pending.resolve(msg);
  return true;
}

// ---- Persistence ----

function loadSessionsMeta() {
  try {
    if (!existsSync(CHAT_SESSIONS_FILE)) return [];
    return JSON.parse(readFileSync(CHAT_SESSIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveSessionsMeta(list) {
  const dir = dirname(CHAT_SESSIONS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CHAT_SESSIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

/**
 * Persist claudeSessionId / codexThreadId for a session to disk so they survive restart.
 * Pass null to explicitly clear a field.
 */
function persistSessionIds(sessionId, claudeSessionId, codexThreadId) {
  const metas = loadSessionsMeta();
  const idx = metas.findIndex(m => m.id === sessionId);
  if (idx === -1) return;
  if (claudeSessionId !== undefined) {
    if (claudeSessionId === null) delete metas[idx].claudeSessionId;
    else metas[idx].claudeSessionId = claudeSessionId;
  }
  if (codexThreadId !== undefined) {
    if (codexThreadId === null) delete metas[idx].codexThreadId;
    else metas[idx].codexThreadId = codexThreadId;
  }
  saveSessionsMeta(metas);
}

// ---- Session Labels ----

const DEFAULT_LABELS = [
  { id: 'started', name: 'Started', color: '#3b82f6' },
  { id: 'asked-for-restart', name: 'Asked for Restart', color: '#eab308' },
  { id: 'pending-review', name: 'Pending Review', color: '#f59e0b' },
  { id: 'planned', name: 'Planned', color: '#8b5cf6' },
  { id: 'done', name: 'Done', color: '#10b981' },
];

function loadLabels() {
  try {
    if (!existsSync(SESSION_LABELS_FILE)) {
      saveLabels(DEFAULT_LABELS);
      return [...DEFAULT_LABELS];
    }
    return JSON.parse(readFileSync(SESSION_LABELS_FILE, 'utf8'));
  } catch {
    return [...DEFAULT_LABELS];
  }
}

function saveLabels(labels) {
  const dir = dirname(SESSION_LABELS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SESSION_LABELS_FILE, JSON.stringify(labels, null, 2), 'utf8');
}

export function getLabels() {
  return loadLabels();
}

export function addLabel(label) {
  const labels = loadLabels();
  labels.push(label);
  saveLabels(labels);
  return label;
}

export function removeLabel(labelId) {
  const labels = loadLabels();
  const idx = labels.findIndex(l => l.id === labelId);
  if (idx === -1) return false;
  labels.splice(idx, 1);
  saveLabels(labels);
  // Clear this label from any sessions that use it
  const metas = loadSessionsMeta();
  let changed = false;
  for (const m of metas) {
    if (m.label === labelId) {
      delete m.label;
      changed = true;
    }
  }
  if (changed) saveSessionsMeta(metas);
  return true;
}

export function updateLabel(labelId, updates) {
  const labels = loadLabels();
  const label = labels.find(l => l.id === labelId);
  if (!label) return null;
  if (updates.name !== undefined) label.name = updates.name;
  if (updates.color !== undefined) label.color = updates.color;
  saveLabels(labels);
  return label;
}

/**
 * Generate experience notes for a completed session using Haiku, then write
 * directly to the workspace's memory/<today>.md file.
 * Does NOT wake up the session — fully background operation.
 */
async function runAutoDistill(sessionId, sessionMeta) {
  console.log(`[session-mgr] Auto-distill start for session ${sessionId.slice(0, 8)}`);

  // Load recent history to give Haiku context about what the session did
  const allEvents = loadHistory(sessionId);
  if (allEvents.length === 0) {
    console.log(`[session-mgr] Auto-distill: no history for ${sessionId.slice(0, 8)}, skipping`);
    return;
  }

  // Build a condensed view of the session for Haiku
  const lines = [];
  for (const evt of allEvents.slice(-60)) { // last 60 events
    if (evt.type === 'message' && evt.role === 'user') {
      lines.push(`USER: ${(evt.content || '').slice(0, 300)}`);
    } else if (evt.type === 'message' && evt.role === 'assistant') {
      lines.push(`ASSISTANT: ${(evt.content || '').slice(0, 400)}`);
    } else if (evt.type === 'file_change') {
      lines.push(`FILE ${(evt.changeType || 'changed').toUpperCase()}: ${evt.filePath}`);
    }
  }
  const historyText = lines.join('\n').slice(0, 8000);

  const today = new Date().toISOString().slice(0, 10);
  const folder = sessionMeta.folder || '';
  const memoryPath = join(folder, 'memory', `${today}.md`);

  const prompt = [
    `Session folder: ${folder}`,
    `Session name: ${sessionMeta.name || '(unnamed)'}`,
    '',
    'Recent activity:',
    historyText,
    '',
    `Write 3-5 concise experience notes in Chinese to append to ${memoryPath}.`,
    'Format (plain markdown, no frontmatter):',
    '',
    `## Auto-distill ${sessionMeta.name || sessionId.slice(0, 8)}（${today}）`,
    '',
    '1. **做了什么**：一句话',
    '2. **踩了什么坑**：如无则省略',
    '3. **可复用的模式**：',
    '4. **遗留问题**：如无则省略',
    '',
    'Reply ONLY with the markdown block. No explanation.',
  ].join('\n');

  const result = await callHaiku(prompt, { timeout: 45000 });
  if (!result || !result.trim()) {
    console.log(`[session-mgr] Auto-distill: Haiku returned empty for ${sessionId.slice(0, 8)}`);
    return;
  }

  // Ensure memory directory exists
  const memDir = dirname(memoryPath);
  if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });

  // Dedup: check if an identical distill heading already exists in the file
  const heading = result.trim().split('\n')[0];
  if (existsSync(memoryPath)) {
    const existing = readFileSync(memoryPath, 'utf8');
    if (existing.includes(heading)) {
      console.log(`[session-mgr] Auto-distill: skipping duplicate for ${sessionId.slice(0, 8)} (heading already exists)`);
      return;
    }
  }

  appendFileSync(memoryPath, '\n' + result.trim() + '\n');
  console.log(`[session-mgr] Auto-distill: wrote to ${memoryPath} for session ${sessionId.slice(0, 8)}`);
}

export function setSessionLabel(sessionId, labelId) {
  const metas = loadSessionsMeta();
  const idx = metas.findIndex(m => m.id === sessionId);
  if (idx === -1) return null;
  const oldLabel = metas[idx].label;
  if (labelId === null || labelId === undefined) {
    delete metas[idx].label;
  } else {
    metas[idx].label = labelId;
  }
  saveSessionsMeta(metas);

  // Auto-distill: when label transitions to done/pending-review, generate experience notes via Haiku
  const triggerLabels = ['done', 'pending-review'];
  if (triggerLabels.includes(labelId) && !triggerLabels.includes(oldLabel)) {
    const distillSession = metas[idx];
    setTimeout(() => {
      runAutoDistill(sessionId, distillSession).catch(e => {
        console.error(`[session-mgr] Auto-distill failed for session ${sessionId.slice(0, 8)}:`, e.message);
      });
    }, 2000);
  }

  const live = liveSessions.get(sessionId);
  const updated = { ...metas[idx], status: live ? live.status : 'idle' };
  broadcast(sessionId, { type: 'session', session: updated });
  broadcastGlobal({ type: 'session', session: updated });
  return updated;
}

// ---- Boot-time label recovery ----
// After a restart, convert all "asked-for-restart" labels back to "started"
{
  const metas = loadSessionsMeta();
  let changed = false;
  for (const m of metas) {
    if (m.label === 'asked-for-restart') {
      m.label = 'started';
      changed = true;
    }
  }
  if (changed) {
    saveSessionsMeta(metas);
    console.log('[session-mgr] Boot: recovered asked-for-restart sessions → started');
  }
}

/**
 * Restart the chat server. Sets the triggering session's label to "asked-for-restart",
 * then exits. systemd will restart the process automatically.
 */
export function restartServer(triggerSessionId) {
  if (triggerSessionId) {
    const metas = loadSessionsMeta();
    const idx = metas.findIndex(m => m.id === triggerSessionId);
    if (idx !== -1) {
      metas[idx].label = 'asked-for-restart';
      saveSessionsMeta(metas);
    }
  }
  console.log(`[session-mgr] Server restart requested by session ${triggerSessionId || 'unknown'}`);
  // Delay slightly to allow the HTTP response to be sent
  setTimeout(() => process.exit(0), 500);
}

// ---- Public API ----

export function listSessions() {
  const metas = loadSessionsMeta();
  return metas.map(m => buildSessionPayload(m));
}

export function getSession(id) {
  const metas = loadSessionsMeta();
  const meta = metas.find(m => m.id === id);
  if (!meta) return null;
  return buildSessionPayload(meta);
}

/**
 * Inject a user message directly into Claude's JSONL conversation file.
 * Used for system notifications to idle sessions — no Claude process is spawned.
 * Returns true on success, false if the file can't be found.
 */
function injectSystemMessageToJSONL(claudeSessionId, folder, text) {
  const home = process.env.HOME || homedir();
  // Convert absolute folder path to Claude project dir name: /home/ally/foo → -home-ally-foo
  const projectDirName = folder.replace(/\//g, '-');
  const jsonlPath = join(home, '.claude', 'projects', projectDirName, `${claudeSessionId}.jsonl`);

  if (!existsSync(jsonlPath)) {
    console.warn(`[session-mgr] JSONL inject: file not found at ${jsonlPath}`);
    return false;
  }

  // Parse last lines to find parentUuid and metadata
  const content = readFileSync(jsonlPath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  let parentUuid = null;
  let slug = null;
  let cwd = folder;
  let version = '2.1.81';

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const d = JSON.parse(lines[i]);
      if (d.uuid && (d.type === 'assistant' || d.type === 'user')) {
        parentUuid = d.uuid;
        if (d.slug) slug = d.slug;
        if (d.cwd) cwd = d.cwd;
        if (d.version) version = d.version;
        break;
      }
    } catch {}
  }

  // Generate UUID in standard format
  const b = randomBytes(16);
  const uuid = `${b.slice(0,4).toString('hex')}-${b.slice(4,6).toString('hex')}-${b.slice(6,8).toString('hex')}-${b.slice(8,10).toString('hex')}-${b.slice(10,16).toString('hex')}`;

  const entry = {
    parentUuid,
    isSidechain: false,
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
    isMeta: true,
    uuid,
    timestamp: new Date().toISOString(),
    userType: 'external',
    entrypoint: 'cli',
    cwd,
    sessionId: claudeSessionId,
    version,
    gitBranch: 'HEAD',
    ...(slug ? { slug } : {}),
  };

  appendFileSync(jsonlPath, '\n' + JSON.stringify(entry));
  console.log(`[session-mgr] JSONL inject: ${jsonlPath.slice(-60)} uuid=${uuid.slice(0, 8)}`);
  return true;
}

export function createSession(folder, tool, name = '', options = {}) {
  const id = generateId();
  const session = {
    id,
    folder,
    tool,
    name: name || '',
    created: new Date().toISOString(),
  };
  if (options.continuedFrom) {
    session.continuedFrom = options.continuedFrom;
  }
  if (options.hidden) {
    session.hidden = true;
  }

  const metas = loadSessionsMeta();
  metas.push(session);
  saveSessionsMeta(metas);

  const result = buildSessionPayload(session, 'idle');
  // Notify all connected clients (e.g. sessions created via REST API or MCP)
  broadcastGlobal({ type: 'session', session: result });
  return result;
}

export function deleteSession(id) {
  const live = liveSessions.get(id);
  if (live?.runner) {
    live.runner.cancel();
  }
  liveSessions.delete(id);

  const metas = loadSessionsMeta();
  const idx = metas.findIndex(m => m.id === id);
  if (idx === -1) return false;
  metas.splice(idx, 1);
  saveSessionsMeta(metas);
  removeSidebarEntry(id);
  broadcastGlobal({ type: 'deleted', sessionId: id });
  return true;
}

export function archiveSession(id, archived) {
  const metas = loadSessionsMeta();
  const idx = metas.findIndex(m => m.id === id);
  if (idx === -1) return null;
  if (archived) {
    metas[idx].archived = true;
  } else {
    delete metas[idx].archived;
  }
  saveSessionsMeta(metas);
  const updated = buildSessionPayload(metas[idx]);
  broadcast(id, { type: 'session', session: updated });
  broadcastGlobal({ type: 'session', session: updated });
  return updated;
}

export function renameSession(id, name) {
  const metas = loadSessionsMeta();
  const idx = metas.findIndex(m => m.id === id);
  if (idx === -1) return null;
  metas[idx].name = name;
  saveSessionsMeta(metas);
  const updated = buildSessionPayload(metas[idx]);
  broadcast(id, { type: 'session', session: updated });
  return updated;
}

export function updateSessionPreferences(id, { tool, model } = {}) {
  const metas = loadSessionsMeta();
  const idx = metas.findIndex(m => m.id === id);
  if (idx === -1) return null;

  let changed = false;
  if (typeof tool === 'string' && tool.trim() && metas[idx].tool !== tool.trim()) {
    metas[idx].tool = tool.trim();
    changed = true;
  }
  if (typeof model === 'string' && model.trim() && metas[idx].model !== model.trim()) {
    metas[idx].model = model.trim();
    changed = true;
  }

  if (changed) {
    saveSessionsMeta(metas);
  }

  const updated = buildSessionPayload(metas[idx]);
  if (changed) {
    broadcast(id, { type: 'session', session: updated });
    broadcastGlobal({ type: 'session', session: updated });
  }
  return updated;
}

/**
 * Subscribe a WebSocket to session events.
 */
export function subscribe(sessionId, ws) {
  let live = liveSessions.get(sessionId);
  if (!live) {
    const meta = loadSessionsMeta().find(m => m.id === sessionId);
    live = createLiveSessionState(meta);
    liveSessions.set(sessionId, live);
  }
  live.listeners.add(ws);
}

export function unsubscribe(sessionId, ws) {
  const live = liveSessions.get(sessionId);
  if (live) {
    live.listeners.delete(ws);
  }
}

/**
 * Broadcast event to all subscribed WebSocket clients.
 */
function broadcast(sessionId, msg) {
  const live = liveSessions.get(sessionId);
  if (!live) return;
  const data = JSON.stringify(msg);
  for (const ws of live.listeners) {
    try {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(data);
      }
    } catch {}
  }
}

function buildMessageRefs(sessionId, attachments = []) {
  const normalized = Array.isArray(attachments) ? attachments : [];
  const imageRefs = normalized
    .filter((attachment) => typeof attachment?.mimeType === 'string' && attachment.mimeType.startsWith('image/'))
    .map((attachment) => {
      const isGlobalImage = attachment.savedPath && resolve(dirname(attachment.savedPath)) === resolve(CHAT_IMAGES_DIR);
      if (isGlobalImage) {
        return {
          filename: attachment.filename,
          originalName: attachment.originalName || attachment.filename,
          mimeType: attachment.mimeType,
          url: `/api/images/${encodeURIComponent(attachment.filename)}`,
          downloadUrl: `/api/images/${encodeURIComponent(attachment.filename)}`,
        };
      }
      const ref = toClientAttachment(sessionId, attachment);
      return {
        filename: ref.filename,
        originalName: ref.originalName,
        mimeType: ref.mimeType,
        url: ref.url,
        downloadUrl: ref.downloadUrl,
        ...(ref.renderAs ? { renderAs: ref.renderAs } : {}),
      };
    });
  const attachmentRefs = normalized.map((attachment) => toClientAttachment(sessionId, attachment));
  return { imageRefs, attachmentRefs };
}

function flushQueuedMessages(sessionId) {
  const live = liveSessions.get(sessionId);
  if (!live || live.runner || !Array.isArray(live.followUpQueue) || live.followUpQueue.length === 0) {
    return false;
  }
  const queue = live.followUpQueue.slice();
  if (queue.length === 0) return false;
  const dispatchText = buildQueuedFollowUpDispatchText(queue);
  const dispatchOptions = resolveQueuedFollowUpDispatchOptions(queue, getSession(sessionId));
  const flattenedAttachments = queue.flatMap((entry) => Array.isArray(entry?.attachments) ? entry.attachments : []);
  const shouldPreserveSystemNotification = queue.length === 1 && queue[0]?.isSystemNotification === true;
  live.followUpQueue = [];
  try {
    sendMessage(sessionId, dispatchText, undefined, {
      tool: dispatchOptions.tool,
      model: dispatchOptions.model,
      thinking: dispatchOptions.thinking,
      isSystemNotification: shouldPreserveSystemNotification,
      preSavedAttachments: flattenedAttachments,
    });
    return true;
  } catch (error) {
    live.followUpQueue = [...queue, ...live.followUpQueue];
    console.error(`[session-mgr] Failed to flush queued follow-up for ${sessionId.slice(0,8)}: ${error.message}`);
    const evt = statusEvent(`error: failed to send queued follow-up: ${error.message}`);
    appendEvent(sessionId, evt);
    broadcast(sessionId, { type: 'event', event: evt });
    return false;
  }
}

/**
 * Send a user message to a session. Spawns a new process if needed.
 */
export function sendMessage(sessionId, text, images, options = {}) {
  let session = getSession(sessionId);
  if (!session) throw new Error('Session not found');

  let live = liveSessions.get(sessionId);
  if (!live) {
    const meta = loadSessionsMeta().find(m => m.id === sessionId);
    live = createLiveSessionState(meta);
    liveSessions.set(sessionId, live);
  }

  // Fast path: system notifications to idle sessions — inject into JSONL, don't spawn Claude
  if (options.isSystemNotification) {
    const isIdle = !live.runner && getQueuedMessageCount(sessionId) === 0;
    if (isIdle) {
      const meta0 = loadSessionsMeta().find(m => m.id === sessionId);
      const existingClaudeId = live?.claudeSessionId || meta0?.claudeSessionId;
      if (existingClaudeId) {
        const ok = injectSystemMessageToJSONL(existingClaudeId, session.folder, text);
        if (ok) {
          const notifEvt = systemNotificationEvent(text);
          appendEvent(sessionId, notifEvt);
          broadcast(sessionId, { type: 'event', event: notifEvt });
          console.log(`[session-mgr] System notification → JSONL inject for ${sessionId.slice(0, 8)}`);
          return;
        }
      }
      // No claudeSessionId or inject failed — fall through to normal spawn
    }
    // Session is active — fall through to normal spawn (message will interrupt/append)
  }

  // Determine effective tool/model: per-message override or session default
  const effectiveTool = options.tool || session.tool;
  const effectiveModel = options.model || session.model;
  const rawAttachments = Array.isArray(options.attachments)
    ? options.attachments
    : Array.isArray(images)
      ? images
      : [];
  console.log(`[session-mgr] sendMessage session=${sessionId.slice(0,8)} tool=${effectiveTool} (session.tool=${session.tool}) thinking=${!!options.thinking} text="${text.slice(0,80)}" attachments=${rawAttachments.length}`);

  const imageInputs = rawAttachments.filter((attachment) => typeof attachment?.mimeType === 'string' && attachment.mimeType.startsWith('image/') && attachment.data);
  const nonImageInputs = rawAttachments.filter((attachment) => !(typeof attachment?.mimeType === 'string' && attachment.mimeType.startsWith('image/') && attachment.data));
  const allSavedAttachments = Array.isArray(options.preSavedAttachments)
    ? options.preSavedAttachments
    : [
      ...saveImages(imageInputs.map((attachment) => ({
        data: attachment.data,
        mimeType: attachment.mimeType,
      }))).map((img) => ({
        filename: img.filename,
        originalName: img.filename,
        savedPath: img.savedPath,
        mimeType: img.mimeType,
      })),
      ...saveAttachments(session, nonImageInputs),
    ];
  const { imageRefs, attachmentRefs } = buildMessageRefs(sessionId, allSavedAttachments);

  // Auto-generate title if session has no name and this is the first message
  if (!session.name && !live.runner) {
    const existingHistory = loadHistory(sessionId);
    if (existingHistory.length === 0) {
      generateAutoTitle(text).then(title => {
        if (title) {
          console.log(`[session-mgr] Auto-title for ${sessionId.slice(0,8)}: "${title}"`);
          renameSession(sessionId, title);
        }
      }).catch(() => {});
    }
  }

  console.log(`[session-mgr] live state: status=${live.status}, hasRunner=${!!live.runner}, claudeSessionId=${live.claudeSessionId || 'none'}, codexThreadId=${live.codexThreadId || 'none'}, listeners=${live.listeners.size}`);

  // If tool was switched, clear resume IDs (they are tool-specific)
  if (effectiveTool !== session.tool) {
    console.log(`[session-mgr] Tool switched from ${session.tool} to ${effectiveTool}, clearing resume IDs`);
    live.claudeSessionId = undefined;
    live.codexThreadId = undefined;
    persistSessionIds(sessionId, null, null);
  }

  if (effectiveTool !== session.tool || (effectiveModel && effectiveModel !== session.model)) {
    const updatedSession = updateSessionPreferences(sessionId, {
      tool: effectiveTool,
      model: effectiveModel,
    });
    if (updatedSession) {
      session = updatedSession;
    }
  }

  if (live.runner) {
    const queueLength = enqueueFollowUp(sessionId, {
      text,
      attachments: allSavedAttachments,
      tool: effectiveTool,
      model: effectiveModel,
      thinking: !!options.thinking,
      isSystemNotification: !!options.isSystemNotification,
    });
    const queuedEvt = statusEvent(`Follow-up queued (${queueLength}) — will append after the current turn finishes`);
    appendEvent(sessionId, queuedEvt);
    broadcast(sessionId, { type: 'event', event: queuedEvt });
    const queuedSession = getSession(sessionId) || session;
    broadcast(sessionId, { type: 'session', session: queuedSession });
    broadcastGlobal({ type: 'session', session: queuedSession });
    console.log(`[session-mgr] Queued follow-up for session ${sessionId.slice(0,8)} depth=${queueLength}`);
    return { queued: true, session: queuedSession };
  }

  // Store user message in history (system notifications use a distinct event type for UI folding)
  const userEvt = options.isSystemNotification
    ? systemNotificationEvent(text)
    : messageEvent(
      'user',
      text,
      imageRefs.length > 0 ? imageRefs : undefined,
      attachmentRefs.length > 0 ? attachmentRefs : undefined,
    );
  appendEvent(sessionId, userEvt);
  broadcast(sessionId, { type: 'event', event: userEvt });

  // Epoch counter: guards onExit from stale processes overwriting new runner state
  live.runEpoch = (live.runEpoch || 0) + 1;
  const myEpoch = live.runEpoch;

  live.status = 'running';
  // System-level: auto-set "running" label when session receives a message
  {
    const metas = loadSessionsMeta();
    const idx = metas.findIndex(m => m.id === sessionId);
    if (idx !== -1) {
      metas[idx].label = 'started';
      saveSessionsMeta(metas);
      session = metas[idx];
    }
  }
  broadcast(sessionId, { type: 'session', session: buildSessionPayload(session, 'running') });
  broadcastGlobal({ type: 'session', session: buildSessionPayload(session, 'running') });

  const onEvent = (evt) => {
    console.log(`[session-mgr] onEvent session=${sessionId.slice(0,8)} type=${evt.type} content=${(evt.content || evt.toolName || '').slice(0, 80)}`);
    appendEvent(sessionId, evt);
    broadcast(sessionId, { type: 'event', event: evt });
  };

  const onExit = (code) => {
    console.log(`[session-mgr] onExit session=${sessionId.slice(0,8)} code=${code} epoch=${myEpoch}`);
    const l = liveSessions.get(sessionId);

    // If a newer sendMessage has started a new process, this onExit is stale — skip cleanup
    if (l && l.runEpoch !== myEpoch) {
      console.log(`[session-mgr] Stale onExit (epoch ${myEpoch} vs current ${l.runEpoch}), skipping`);
      return;
    }

    // Auto-retry: if --resume failed (non-zero exit, resume was attempted, not already retried),
    // clear the stale claudeSessionId and re-spawn the same message fresh.
    if (code !== 0 && spawnOptions.claudeSessionId && !spawnOptions._retried) {
      console.log(`[session-mgr] Resume failed for session ${sessionId.slice(0,8)}, retrying without --resume`);
      delete spawnOptions.claudeSessionId;
      spawnOptions._retried = true;
      if (l) {
        l.claudeSessionId = undefined;
        const retryRunner = spawnTool(effectiveTool, session.folder, text, onEvent, onExit, spawnOptions);
        l.runner = retryRunner;
      }
      return;
    }

    if (l) {
      // Capture session/thread IDs for next resume
      if (l.runner?.claudeSessionId) {
        l.claudeSessionId = l.runner.claudeSessionId;
        console.log(`[session-mgr] Saved claudeSessionId=${l.claudeSessionId} for session ${sessionId.slice(0,8)}`);
        unregisterClaudeSession(l.runner.claudeSessionId);
      }
      if (l.runner?.codexThreadId) {
        l.codexThreadId = l.runner.codexThreadId;
        console.log(`[session-mgr] Saved codexThreadId=${l.codexThreadId} for session ${sessionId.slice(0,8)}`);
      }
      // Persist IDs to disk so they survive server restart
      persistSessionIds(sessionId, l.claudeSessionId, l.codexThreadId);
      l.status = 'idle';
      l.runner = null;
    }
    // Re-fetch session from disk to pick up any changes (e.g. auto-title rename)
    const freshSession = getSession(sessionId) || session;
    if (flushQueuedMessages(sessionId)) {
      return;
    }
    // Notify any waiters (e.g. workflow engine's createAndRun)
    const waiters = completionWaiters.get(sessionId);
    if (waiters && waiters.length > 0) {
      completionWaiters.delete(sessionId);
      for (const w of waiters) w.resolve();
    }
    // Reject any pending hook so the HTTP long-poll can unblock
    const pending = pendingHooks.get(sessionId);
    if (pending) {
      pendingHooks.delete(sessionId);
      pending.reject(new Error('Session ended before hook was resolved'));
    }
    broadcast(sessionId, {
      type: 'session',
      session: buildSessionPayload(freshSession, 'idle'),
    });
    broadcastGlobal({ type: 'session', session: buildSessionPayload(freshSession, 'idle') });
    // Trigger async sidebar summary (non-blocking, does not affect session flow)
    triggerSummary({ id: sessionId, folder: freshSession.folder, name: freshSession.name || '' });
    // Check if a pending restart is waiting for all sessions to be idle
    checkPendingRestartOnIdle();

  };

  const spawnOptions = { sessionId };
  if (live.claudeSessionId) {
    spawnOptions.claudeSessionId = live.claudeSessionId;
    console.log(`[session-mgr] Will resume Claude session: ${live.claudeSessionId}`);
  }
  if (live.codexThreadId) {
    spawnOptions.codexThreadId = live.codexThreadId;
    console.log(`[session-mgr] Will resume Codex thread: ${live.codexThreadId}`);
  }

  if (allSavedAttachments.length > 0) {
    spawnOptions.attachments = allSavedAttachments;
  }
  if (options.thinking) {
    spawnOptions.thinking = true;
  }
  if (effectiveModel) {
    spawnOptions.model = effectiveModel;
  }
  // Register Claude's session_id → our sessionId mapping when Claude announces itself
  spawnOptions.onClaudeSessionId = (claudeSessionId) => {
    registerClaudeSession(claudeSessionId, sessionId);
  };

  // Log Claude session file size if resuming (helps diagnose slow --resume)
  if (spawnOptions.claudeSessionId) {
    const home = process.env.HOME || '';
    const sessDir = join(home, '.claude', 'projects');
    try {
      // Search for the session JSONL file across all project dirs
      const projects = readdirSync(sessDir);
      for (const proj of projects) {
        const sessFile = join(sessDir, proj, '.sessions', spawnOptions.claudeSessionId + '.jsonl');
        if (existsSync(sessFile)) {
          const size = statSync(sessFile).size;
          const sizeKB = (size / 1024).toFixed(1);
          console.log(`[session-mgr] Claude session file: ${sessFile} (${sizeKB} KB)`);
          break;
        }
      }
    } catch {}
  }

  console.log(`[session-mgr] Spawning tool=${effectiveTool} folder=${session.folder} thinking=${!!options.thinking}`);
  const runner = spawnTool(effectiveTool, session.folder, text, onEvent, onExit, spawnOptions);
  live.runner = runner;
}

/**
 * Cancel the running process for a session.
 */
export function cancelSession(sessionId) {
  const live = liveSessions.get(sessionId);
  if (live?.runner) {
    // Increment epoch so the stale onExit from the killed process is ignored
    // (prevents auto-retry from re-spawning with the old message)
    live.runEpoch = (live.runEpoch || 0) + 1;
    // Capture session/thread IDs before killing so next message can --resume
    if (live.runner.claudeSessionId) {
      live.claudeSessionId = live.runner.claudeSessionId;
      console.log(`[session-mgr] Cancel: saved claudeSessionId=${live.claudeSessionId} for session ${sessionId.slice(0,8)}`);
      unregisterClaudeSession(live.runner.claudeSessionId);
    }
    if (live.runner.codexThreadId) {
      live.codexThreadId = live.runner.codexThreadId;
      console.log(`[session-mgr] Cancel: saved codexThreadId=${live.codexThreadId} for session ${sessionId.slice(0,8)}`);
    }
    // Persist IDs to disk so they survive server restart
    persistSessionIds(sessionId, live.claudeSessionId, live.codexThreadId);
    live.runner.cancel();
    live.runner = null;
    live.status = 'idle';
    // Reject any pending hook so the HTTP long-poll can unblock
    const pending = pendingHooks.get(sessionId);
    if (pending) {
      pendingHooks.delete(sessionId);
      pending.reject(new Error('Session cancelled by user'));
    }
    const session = getSession(sessionId);
    broadcast(sessionId, {
      type: 'session',
      session: buildSessionPayload(session, 'idle'),
    });
    broadcastGlobal({ type: 'session', session: buildSessionPayload(session, 'idle') });
    const evt = statusEvent('cancelled');
    appendEvent(sessionId, evt);
    broadcast(sessionId, { type: 'event', event: evt });
  }
}

export function appendAssistantAttachmentMessage(sessionId, text = '', attachments = []) {
  const session = getSession(sessionId);
  if (!session) throw new Error('Session not found');
  const savedAttachments = saveAttachments(session, attachments.map((attachment) => ({
    ...attachment,
    renderAs: attachment.renderAs || 'file',
  })));
  const clientAttachments = savedAttachments.map((attachment) => toClientAttachment(sessionId, attachment));
  const imageRefs = clientAttachments.filter((attachment) => typeof attachment.mimeType === 'string' && attachment.mimeType.startsWith('image/'));
  const evt = messageEvent(
    'assistant',
    text,
    imageRefs.length > 0 ? imageRefs : undefined,
    clientAttachments.length > 0 ? clientAttachments : undefined,
  );
  appendEvent(sessionId, evt);
  broadcast(sessionId, { type: 'event', event: evt });
  return evt;
}

/**
 * Get session history for replay on reconnect.
 */
export function getHistory(sessionId) {
  return loadHistory(sessionId);
}

// ---- Auto-compact ----


/**
 * Auto-compact a session: generate summary, create new session, seamlessly switch listeners.
 */
export async function compactSession(sessionId) {
  const session = getSession(sessionId);
  if (!session) throw new Error('Session not found');

  console.log(`[session-mgr] Starting compact for session ${sessionId.slice(0,8)}`);

  // Broadcast compacting status to listeners
  const compactingEvt = statusEvent('Compacting context...');
  appendEvent(sessionId, compactingEvt);
  broadcast(sessionId, { type: 'event', event: compactingEvt });

  // Generate summary
  const summary = await generateCompactSummary(sessionId, session.folder);
  console.log(`[session-mgr] Compact summary generated (${summary.length} chars)`);

  // Determine continued name
  const match = session.name?.match(/\(continued(?: (\d+))?\)$/);
  let newName;
  if (match) {
    const n = match[1] ? parseInt(match[1], 10) + 1 : 2;
    newName = session.name.replace(/\(continued(?: \d+)?\)$/, `(continued ${n})`);
  } else {
    newName = `${session.name || session.folder.split('/').pop()} (continued)`;
  }

  // Create new session
  const newSession = createSession(session.folder, session.tool, newName, { continuedFrom: sessionId });
  console.log(`[session-mgr] Created continuation session ${newSession.id.slice(0,8)}`);

  // Record compact events in both sessions
  const summaryExcerpt = summary.slice(0, 200) + (summary.length > 200 ? '...' : '');
  const oldEvt = compactEvent(sessionId, newSession.id, summaryExcerpt);
  appendEvent(sessionId, oldEvt);

  const newEvt = compactEvent(sessionId, newSession.id, summaryExcerpt);
  appendEvent(newSession.id, newEvt);

  // Transfer listeners from old session to new session
  const oldLive = liveSessions.get(sessionId);
  const listeners = oldLive ? new Set(oldLive.listeners) : new Set();

  // Set up new session in liveSessions
  let newLive = liveSessions.get(newSession.id);
  if (!newLive) {
    newLive = createLiveSessionState();
    liveSessions.set(newSession.id, newLive);
  }
  for (const ws of listeners) {
    newLive.listeners.add(ws);
  }

  // Broadcast compact switch to all listeners (on old session, before detach)
  broadcast(sessionId, { type: 'compact', oldSessionId: sessionId, newSessionId: newSession.id });

  // Send the summary as the first message to the new session
  const summaryPrompt = [
    '[Context compaction — this is a continuation of a previous conversation. Here is the summary of what we\'ve been working on:]',
    '',
    summary,
    '',
    '[Please acknowledge you\'ve reviewed the above context and confirm you\'re ready to continue. Then wait for the user\'s next instruction.]',
  ].join('\n');

  sendMessage(newSession.id, summaryPrompt, undefined, { tool: session.tool });
}

/**
 * Returns a Promise that resolves when the session next becomes idle.
 * Used by workflow engine tasks to wait for Claude to finish.
 */
export function waitForIdle(sessionId, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const waiters = completionWaiters.get(sessionId);
      if (waiters) {
        const idx = waiters.indexOf(entry);
        if (idx !== -1) waiters.splice(idx, 1);
      }
      reject(new Error(`Timeout waiting for session ${sessionId.slice(0,8)} to become idle`));
    }, timeoutMs);

    const entry = {
      resolve: () => { clearTimeout(timer); resolve(); },
      reject,
    };

    if (!completionWaiters.has(sessionId)) completionWaiters.set(sessionId, []);
    completionWaiters.get(sessionId).push(entry);
  });
}

/**
 * Create a session, send a prompt, wait for completion, return last assistant message.
 * Used by the workflow engine to run tasks headlessly.
 */
export async function createAndRun(folder, model, prompt, { timeoutMs = 5 * 60 * 1000, tool = 'codex' } = {}) {
  const session = createSession(folder, tool, `workflow-${Date.now()}`, { hidden: true });

  // Register waiter BEFORE sendMessage to avoid a race where onExit fires synchronously
  const idlePromise = waitForIdle(session.id, timeoutMs);

  sendMessage(session.id, prompt, undefined, { model, tool });

  await idlePromise;

  // Extract last assistant message content from history
  const history = loadHistory(session.id);
  const lastMsg = [...history].reverse().find(e => e.type === 'message' && e.role === 'assistant');
  const output = lastMsg?.content || '[no assistant output]';
  return { output, sessionId: session.id };
}

// ---- Restart recovery ----

function saveInterruptedSessions() {
  const interrupted = [];
  for (const [sessionId, live] of liveSessions) {
    if (live.runner && live.status === 'running') {
      const claudeSessionId = live.runner.claudeSessionId || live.claudeSessionId;
      const codexThreadId = live.runner.codexThreadId || live.codexThreadId;
      interrupted.push({ sessionId, claudeSessionId, codexThreadId });
      // Record interrupt event in history
      const evt = restartInterruptEvent();
      appendEvent(sessionId, evt);
      broadcast(sessionId, { type: 'event', event: evt });
    }
  }
  if (interrupted.length > 0) {
    const dir = dirname(INTERRUPTED_SESSIONS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(INTERRUPTED_SESSIONS_FILE, JSON.stringify(interrupted, null, 2), 'utf8');
    console.log(`[session-mgr] Saved ${interrupted.length} interrupted session(s) for recovery`);
  }
}

export function broadcastRestart() {
  broadcastGlobal({ type: 'server_restart', message: 'Server is restarting. Sessions will resume automatically...' });
}

export async function recoverInterruptedSessions() {
  try {
    if (!existsSync(INTERRUPTED_SESSIONS_FILE)) return;
    const interrupted = JSON.parse(readFileSync(INTERRUPTED_SESSIONS_FILE, 'utf8'));
    unlinkSync(INTERRUPTED_SESSIONS_FILE);
    if (!interrupted || interrupted.length === 0) return;
    console.log(`[session-mgr] Recovering ${interrupted.length} interrupted session(s)`);
    // Brief delay to let the server fully initialize
    await new Promise(r => setTimeout(r, 2000));
    for (const { sessionId } of interrupted) {
      const session = getSession(sessionId);
      if (!session) {
        console.log(`[session-mgr] Interrupted session ${sessionId.slice(0, 8)} not found, skipping`);
        continue;
      }
      console.log(`[session-mgr] Auto-resuming session ${sessionId.slice(0, 8)}: ${session.name}`);
      // Append resume event to history so it shows in chat on reconnect
      const resumeEvt = restartResumeEvent();
      appendEvent(sessionId, resumeEvt);
      // Send resume message (uses existing --resume claudeSessionId mechanism)
      try {
        sendMessage(sessionId, '[SERVER NOTIFICATION] The RemoteLab server was automatically restarted. Your session has been resumed. Do NOT restart any services. Please review your conversation history and continue your previous task from where you left off.', null, {});
      } catch (err) {
        console.error(`[session-mgr] Failed to resume session ${sessionId.slice(0, 8)}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[session-mgr] Failed to recover interrupted sessions:', err.message);
  }
}

/**
 * Kill all running processes (for shutdown).
 */
export function killAll() {
  saveInterruptedSessions();
  for (const [, live] of liveSessions) {
    if (live.runner) {
      live.runner.cancel();
    }
  }
  liveSessions.clear();
}

// ---- Pending restart (wait-for-idle) ----

let pendingRestartState = null; // { requestedBy, requestedAt, checkInterval }

/**
 * Request a "wait and restart": monitor all sessions, restart when all are idle.
 */
export function requestWaitRestart(triggerSessionId) {
  if (pendingRestartState) {
    return { alreadyPending: true, requestedAt: pendingRestartState.requestedAt };
  }

  // Check if all sessions are already idle
  if (areAllSessionsIdle()) {
    console.log('[session-mgr] All sessions already idle, restarting immediately');
    restartServer(triggerSessionId);
    return { immediate: true };
  }

  pendingRestartState = {
    requestedBy: triggerSessionId,
    requestedAt: Date.now(),
    // Poll every 5s as a safety net (primary trigger is onExit hook)
    checkInterval: setInterval(() => {
      if (areAllSessionsIdle()) {
        console.log('[session-mgr] All sessions idle (poll), executing pending restart');
        executePendingRestart();
      }
    }, 5000),
  };

  console.log(`[session-mgr] Pending restart requested by session ${triggerSessionId || 'unknown'}`);
  broadcastGlobal({
    type: 'pending_restart',
    message: 'Waiting for all sessions to finish before restarting...',
    requestedBy: triggerSessionId,
    requestedAt: pendingRestartState.requestedAt,
  });

  return { pending: true, requestedAt: pendingRestartState.requestedAt };
}

/**
 * Cancel a pending restart.
 */
export function cancelPendingRestart() {
  if (!pendingRestartState) return false;
  clearInterval(pendingRestartState.checkInterval);
  pendingRestartState = null;
  console.log('[session-mgr] Pending restart cancelled');
  broadcastGlobal({ type: 'pending_restart_cancelled' });
  return true;
}

/**
 * Get pending restart info (for API).
 */
export function getPendingRestart() {
  if (!pendingRestartState) return null;
  return {
    requestedBy: pendingRestartState.requestedBy,
    requestedAt: pendingRestartState.requestedAt,
  };
}

function areAllSessionsIdle() {
  for (const [, live] of liveSessions) {
    if (live.status === 'running') return false;
  }
  return true;
}

function executePendingRestart() {
  if (!pendingRestartState) return;
  const triggerSessionId = pendingRestartState.requestedBy;
  clearInterval(pendingRestartState.checkInterval);
  pendingRestartState = null;
  restartServer(triggerSessionId);
}

/**
 * Called when any session transitions to idle. Checks pending restart.
 */
export function checkPendingRestartOnIdle() {
  if (!pendingRestartState) return;
  if (areAllSessionsIdle()) {
    console.log('[session-mgr] All sessions idle, executing pending restart');
    executePendingRestart();
  }
}
