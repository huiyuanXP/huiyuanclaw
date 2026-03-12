#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const realtimeSource = readFileSync(join(repoRoot, 'static/chat/realtime.js'), 'utf8');
const sessionHttpSource = readFileSync(join(repoRoot, 'static/chat/session-http.js'), 'utf8');

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing start token: ${startToken}`);
  }
  const end = source.indexOf(endToken, start);
  if (end === -1) {
    throw new Error(`Missing end token: ${endToken}`);
  }
  return source.slice(start, end);
}

function createSessionActivity({
  runState = 'idle',
  phase = null,
  runId = null,
  recoverable = false,
  queueState = 'idle',
  queueCount = 0,
  renameState = 'idle',
  renameError = null,
  compactState = 'idle',
} = {}) {
  return {
    run: {
      state: runState,
      phase,
      runId,
      cancelRequested: false,
      recoverable,
    },
    queue: {
      state: queueState,
      count: queueCount,
    },
    rename: {
      state: renameState,
      error: renameError,
    },
    compact: {
      state: compactState,
    },
  };
}

function createBaseContext() {
  const context = {
    console,
    Date,
    JSON,
    Set,
    Map,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Math,
    Promise,
    encodeURIComponent,
    currentSessionId: null,
    hasAttachedSession: false,
    sessions: [],
    visitorMode: false,
    getEffectiveSessionAppId(session) {
      return session?.appId || 'chat';
    },
  };
  context.globalThis = context;
  return context;
}

const normalizeSessionStatusSnippet = sliceBetween(
  realtimeSource,
  'function normalizeSessionStatus',
  'function updateResumeButton',
);

const normalizeSessionRecordSnippet = sliceBetween(
  sessionHttpSource,
  'function normalizeSessionRecord',
  'function upsertSession',
);

const dispatchActionSnippet = sliceBetween(
  realtimeSource,
  'async function dispatchAction',
  'function getCurrentSession',
);

const recordContext = createBaseContext();
vm.runInNewContext(
  `${normalizeSessionStatusSnippet}\n${normalizeSessionRecordSnippet}`,
  recordContext,
  { filename: 'chat-session-record-runtime.js' },
);

const restored = recordContext.normalizeSessionRecord(
  {
    id: 'session-restore',
    status: 'idle',
    activity: createSessionActivity(),
    lastEventAt: '2026-03-12T12:00:00.000Z',
  },
  {
    id: 'session-restore',
    status: 'idle',
    activity: createSessionActivity(),
    archived: true,
    archivedAt: '2026-03-12T11:59:00.000Z',
  },
);
assert.equal(restored.archived, undefined, 'stale archived flags should not survive a fresh session payload');
assert.equal(restored.archivedAt, undefined, 'stale archived timestamps should not survive a fresh session payload');
assert.equal(restored.status, 'idle', 'session status should stay aligned with backend activity');

const carriedQueue = recordContext.normalizeSessionRecord(
  {
    id: 'session-queue',
    status: 'running',
    activity: createSessionActivity({ runState: 'running', queueState: 'queued', queueCount: 1 }),
  },
  {
    id: 'session-queue',
    queuedMessages: [{ text: 'queued follow-up' }],
  },
);
assert.deepEqual(
  carriedQueue.queuedMessages,
  [{ text: 'queued follow-up' }],
  'queued message details should stay attached while the backend queue is still non-empty',
);

const clearedQueue = recordContext.normalizeSessionRecord(
  {
    id: 'session-queue',
    status: 'idle',
    activity: createSessionActivity(),
  },
  {
    id: 'session-queue',
    queuedMessages: [{ text: 'queued follow-up' }],
  },
);
assert.equal(
  Object.prototype.hasOwnProperty.call(clearedQueue, 'queuedMessages'),
  false,
  'queued message details should clear once the backend queue drains',
);

const dispatchContext = createBaseContext();
let refreshCalls = 0;
let renderCalls = 0;
let savedPendingCalls = 0;
let clearedPendingCalls = 0;
let attentionRefreshes = 0;
let scheduledRefreshes = 0;
let appliedSession = null;
let requestPayload = null;

dispatchContext.currentSessionId = 'session-send';
dispatchContext.createRequestId = () => 'req-test';
dispatchContext.fetchSessionsList = async () => [];
dispatchContext.refreshCurrentSession = async () => {
  refreshCalls += 1;
  if (refreshCalls === 1) {
    throw new Error('temporary refresh failure');
  }
  return { ok: true };
};
dispatchContext.fetchJsonOrRedirect = async (url, options = {}) => {
  requestPayload = { url, options };
  return {
    queued: true,
    session: {
      id: 'session-send',
      status: 'running',
      activity: createSessionActivity({ runState: 'running', queueState: 'queued', queueCount: 1 }),
    },
  };
};
dispatchContext.upsertSession = (value) => {
  dispatchContext.sessions = [value];
  return value;
};
dispatchContext.renderSessionList = () => {
  renderCalls += 1;
};
dispatchContext.applyAttachedSessionState = (id, session) => {
  appliedSession = { id, session };
};
dispatchContext.refreshSidebarSession = async () => null;
dispatchContext.savePendingMessage = () => {
  savedPendingCalls += 1;
};
dispatchContext.clearPendingMessage = () => {
  clearedPendingCalls += 1;
};
dispatchContext.refreshSessionAttentionUi = () => {
  attentionRefreshes += 1;
};
dispatchContext.setTimeout = (fn) => {
  scheduledRefreshes += 1;
  fn();
  return 1;
};

vm.runInNewContext(dispatchActionSnippet, dispatchContext, {
  filename: 'chat-dispatch-action-runtime.js',
});

const sendAccepted = await dispatchContext.dispatchAction({ action: 'send', text: 'hello world' });
assert.equal(sendAccepted, true, 'send should resolve successfully after server acceptance');
assert.equal(requestPayload?.url, '/api/sessions/session-send/messages');
assert.match(String(requestPayload?.options?.body || ''), /"requestId":"req-test"/);
assert.equal(renderCalls, 1, 'accepted sends should immediately reflect the backend session payload');
assert.deepEqual(
  appliedSession,
  {
    id: 'session-send',
    session: {
      id: 'session-send',
      status: 'running',
      activity: createSessionActivity({ runState: 'running', queueState: 'queued', queueCount: 1 }),
    },
  },
  'accepted sends should apply the returned backend session state before the refresh finishes',
);
assert.equal(refreshCalls, 2, 'accepted sends should retry the session refresh after a transient failure');
assert.equal(scheduledRefreshes, 1, 'accepted sends should schedule exactly one async refresh retry');
assert.equal(savedPendingCalls, 0, 'frontend should not persist pending-send state');
assert.equal(clearedPendingCalls, 0, 'frontend should not clear any pending-send cache because none exists');
assert.equal(attentionRefreshes, 0, 'frontend should not synthesize unread or send-failure attention state');

console.log('test-chat-session-state: ok');
