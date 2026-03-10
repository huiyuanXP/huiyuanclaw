#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn } from 'child_process';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = __dirname;
const cookie = 'session_token=test-session';

function randomPort() {
  return 33000 + Math.floor(Math.random() * 10000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, description, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out: ${description}`);
}

function request(port, method, path, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Cookie: cookie,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch {}
          resolve({ status: res.statusCode, headers: res.headers, json, text: data });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function setupTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'remotelab-http-phase1-'));
  const configDir = join(home, '.config', 'remotelab');
  const localBin = join(home, '.local', 'bin');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(localBin, { recursive: true });

  writeFileSync(
    join(configDir, 'auth.json'),
    JSON.stringify({ token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(configDir, 'auth-sessions.json'),
    JSON.stringify({
      'test-session': { expiry: Date.now() + 60 * 60 * 1000, role: 'owner' },
    }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(configDir, 'tools.json'),
    JSON.stringify([
      {
        id: 'fake-codex',
        name: 'Fake Codex',
        command: 'fake-codex',
        runtimeFamily: 'codex-json',
        models: [{ id: 'fake-model', label: 'Fake model', defaultEffort: 'low' }],
        reasoning: { kind: 'enum', label: 'Reasoning', levels: ['low'], default: 'low' },
      },
    ], null, 2),
    'utf8',
  );
  writeFileSync(
    join(localBin, 'fake-codex'),
    `#!/usr/bin/env node
const delay = Number(process.env.FAKE_CODEX_DELAY_MS || '700');
let cancelled = false;
process.on('SIGTERM', () => {
  cancelled = true;
  setTimeout(() => process.exit(143), 20);
});
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-test' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  if (cancelled) return;
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'command_execution', command: 'echo fake', aggregated_output: 'fake', exit_code: 0, status: 'completed' }
  }));
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'finished from fake codex' }
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 }
  }));
  process.exit(0);
}, delay);
`,
    'utf8',
  );
  chmodSync(join(localBin, 'fake-codex'), 0o755);
  return { home, configDir, localBin };
}

async function startServer({ home, port, delayMs = 700 }) {
  const child = spawn(process.execPath, ['chat-server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CHAT_PORT: String(port),
      SECURE_COOKIES: '0',
      FAKE_CODEX_DELAY_MS: String(delayMs),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  await waitFor(async () => {
    try {
      const res = await request(port, 'GET', '/api/auth/me');
      return res.status === 200;
    } catch {
      return false;
    }
  }, 'server startup');

  return {
    child,
    getStdout: () => stdout,
    getStderr: () => stderr,
  };
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await waitFor(() => server.child.exitCode !== null, 'server shutdown');
}

async function createSession(port, { name = 'Phase1', group = 'Tests', description = 'HTTP runtime' } = {}) {
  const res = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'fake-codex',
    name,
    group,
    description,
  });
  assert.equal(res.status, 201, 'create session should succeed');
  return res.json.session;
}

async function submitMessage(port, sessionId, requestId, text = 'Run the fake tool') {
  const res = await request(port, 'POST', `/api/sessions/${sessionId}/messages`, {
    requestId,
    text,
    tool: 'fake-codex',
    model: 'fake-model',
    effort: 'low',
  });
  assert.ok(res.status === 202 || res.status === 200, 'submit message should succeed');
  return res;
}

async function waitForRunTerminal(port, runId) {
  return waitFor(async () => {
    const res = await request(port, 'GET', `/api/runs/${runId}`);
    if (res.status !== 200) return false;
    if (!['completed', 'failed', 'cancelled'].includes(res.json.run.state)) return false;
    return res.json.run;
  }, `run ${runId} terminal`);
}

async function waitForRunState(port, runId, expectedState) {
  return waitFor(async () => {
    const res = await request(port, 'GET', `/api/runs/${runId}`);
    if (res.status !== 200) return false;
    if (res.json.run.state !== expectedState) return false;
    return res.json.run;
  }, `run ${runId} ${expectedState}`);
}

async function getEvents(port, sessionId, afterSeq = 0) {
  const res = await request(port, 'GET', `/api/sessions/${sessionId}/events?afterSeq=${afterSeq}&limit=500`);
  assert.equal(res.status, 200, 'events request should succeed');
  return res.json;
}

async function phase1Contract() {
  const { home } = setupTempHome();
  const port = randomPort();
  const server = await startServer({ home, port });
  try {
    const session = await createSession(port);
    const detail = await request(port, 'GET', `/api/sessions/${session.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.session.id, session.id);

    const first = await submitMessage(port, session.id, 'req-contract');
    const duplicate = await submitMessage(port, session.id, 'req-contract');
    assert.equal(duplicate.json.duplicate, true, 'same requestId should dedupe');
    assert.equal(first.json.run.id, duplicate.json.run.id, 'duplicate request should reuse run');

    const runRead = await request(port, 'GET', `/api/runs/${first.json.run.id}`);
    assert.equal(runRead.status, 200);
    assert.equal(runRead.json.run.requestId, 'req-contract');
    console.log('phase1-contract: ok');
  } finally {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
}

async function phase2HttpCanonical() {
  const { home } = setupTempHome();
  const port = randomPort();
  const server = await startServer({ home, port });
  try {
    const session = await createSession(port, { name: 'Canonical', group: 'Tests', description: 'HTTP only' });
    const submit = await submitMessage(port, session.id, 'req-http-only');
    await waitForRunTerminal(port, submit.json.run.id);

    const snapshot = await request(port, 'GET', `/api/sessions/${session.id}`);
    assert.equal(snapshot.status, 200);
    const events = await getEvents(port, session.id, 0);
    assert.ok(events.events.some((event) => event.type === 'message' && event.role === 'user'));
    assert.ok(events.events.some((event) => event.type === 'message' && event.role === 'assistant'));
    console.log('phase2-http-canonical: ok');
  } finally {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
}

async function phase3Storage() {
  const { home, configDir } = setupTempHome();
  const port = randomPort();
  const server = await startServer({ home, port });
  try {
    const session = await createSession(port, { name: 'Storage', group: 'Tests', description: 'Storage' });
    const submit = await submitMessage(port, session.id, 'req-storage');
    await waitForRunTerminal(port, submit.json.run.id);

    const historyRoot = join(configDir, 'chat-history', session.id);
    const runDir = join(configDir, 'chat-runs', submit.json.run.id);
    assert.equal(existsSync(join(historyRoot, 'meta.json')), true, 'history meta should exist');
    assert.equal(existsSync(join(historyRoot, 'events', '000000001.json')), true, 'history events should be sharded');
    assert.equal(existsSync(join(runDir, 'status.json')), true, 'run status should exist');
    assert.equal(existsSync(join(runDir, 'spool.jsonl')), true, 'run spool should exist');
    assert.equal(existsSync(join(runDir, 'result.json')), true, 'run result should exist');
    const eventsDir = join(historyRoot, 'events');
    const eventFiles = ['000000001.json', '000000002.json', '000000003.json'].map((name) => JSON.parse(readFileSync(join(eventsDir, name), 'utf8')));
    assert.ok(eventFiles.every((event, index) => event.seq === index + 1), 'history should be sequence-based');
    console.log('phase3-storage: ok');
  } finally {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
}

async function phase4RunnerThin() {
  const { home, configDir } = setupTempHome();
  const port = randomPort();
  const server = await startServer({ home, port });
  try {
    const session = await createSession(port, { name: 'Runner', group: 'Tests', description: 'Thin runner' });
    const submit = await submitMessage(port, session.id, 'req-runner');
    await waitForRunTerminal(port, submit.json.run.id);

    const spoolPath = join(configDir, 'chat-runs', submit.json.run.id, 'spool.jsonl');
    const records = readFileSync(spoolPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(records.some((record) => record.stream === 'stdout' && typeof record.line === 'string'));
    assert.equal(records.some((record) => record.type === 'message'), false, 'runner spool should stay raw');
    console.log('phase4-runner-thin: ok');
  } finally {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
}

async function phase5RestartSurvival() {
  const { home } = setupTempHome();
  const port = randomPort();
  let server = await startServer({ home, port, delayMs: 1600 });
  try {
    const session = await createSession(port, { name: 'Restart', group: 'Tests', description: 'Restart survival' });
    const submit = await submitMessage(port, session.id, 'req-restart', 'slow run');
    await waitFor(async () => {
      const run = await request(port, 'GET', `/api/runs/${submit.json.run.id}`);
      return run.status === 200 && run.json.run.state === 'running';
    }, 'run should enter running state');

    await stopServer(server);
    await sleep(500);
    server = await startServer({ home, port, delayMs: 1600 });

    const finalRun = await waitForRunTerminal(port, submit.json.run.id);
    assert.equal(finalRun.state, 'completed', 'detached run should survive restart');
    const events = await getEvents(port, session.id, 0);
    assert.ok(events.events.some((event) => event.type === 'message' && event.role === 'assistant'));
    console.log('phase5-restart-survival: ok');
  } finally {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
}

async function phase6WsInvalidationOnly() {
  const { home } = setupTempHome();
  const port = randomPort();
  const server = await startServer({ home, port });
  let ws;
  try {
    const messages = [];
    ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
      socket.on('open', () => resolve(socket));
      socket.on('error', reject);
      socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
    });

    const session = await createSession(port, { name: 'WS', group: 'Tests', description: 'Invalidation only' });
    const submit = await submitMessage(port, session.id, 'req-ws');
    await waitForRunTerminal(port, submit.json.run.id);
    await waitFor(() => messages.some((message) => message.type === 'session_invalidated'), 'ws invalidation');
    const forbidden = new Set(['session', 'sessions', 'history', 'event', 'archived_list', 'unarchived', 'sidebar_update']);
    assert.equal(messages.some((message) => forbidden.has(message.type)), false, 'ws should stay invalidation-only');
    console.log('phase6-ws-invalidation-only: ok');
  } finally {
    if (ws) ws.close();
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
}

async function phase7EtagRevalidation() {
  const { home } = setupTempHome();
  const port = randomPort();
  const server = await startServer({ home, port });
  try {
    const session = await createSession(port, { name: 'ETag', group: 'Tests', description: 'Conditional GETs' });

    const detail = await request(port, 'GET', `/api/sessions/${session.id}`);
    assert.equal(detail.status, 200);
    assert.ok(detail.headers.etag, 'session detail should include an ETag');

    const detail304 = await request(
      port,
      'GET',
      `/api/sessions/${session.id}`,
      null,
      { 'If-None-Match': detail.headers.etag },
    );
    assert.equal(detail304.status, 304, 'unchanged session detail should revalidate to 304');

    const events = await request(port, 'GET', `/api/sessions/${session.id}/events?afterSeq=0&limit=500`);
    assert.equal(events.status, 200);
    assert.ok(events.headers.etag, 'session events should include an ETag');

    const events304 = await request(
      port,
      'GET',
      `/api/sessions/${session.id}/events?afterSeq=0&limit=500`,
      null,
      { 'If-None-Match': events.headers.etag },
    );
    assert.equal(events304.status, 304, 'unchanged event history should revalidate to 304');

    const submit = await submitMessage(port, session.id, 'req-etag');
    await waitForRunTerminal(port, submit.json.run.id);

    const detailAfterRun = await request(
      port,
      'GET',
      `/api/sessions/${session.id}`,
      null,
      { 'If-None-Match': detail.headers.etag },
    );
    assert.equal(detailAfterRun.status, 200, 'changed session detail must return a fresh payload');
    assert.notEqual(detailAfterRun.headers.etag, detail.headers.etag, 'session detail ETag should change after a run');

    const eventsAfterRun = await request(
      port,
      'GET',
      `/api/sessions/${session.id}/events?afterSeq=0&limit=500`,
      null,
      { 'If-None-Match': events.headers.etag },
    );
    assert.equal(eventsAfterRun.status, 200, 'changed event history must return a fresh payload');
    assert.notEqual(eventsAfterRun.headers.etag, events.headers.etag, 'event history ETag should change after a run');
    console.log('phase7-etag-revalidation: ok');
  } finally {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
}

async function phase8CancelRecovery() {
  const { home } = setupTempHome();
  const port = randomPort();
  const server = await startServer({ home, port, delayMs: 4000 });
  try {
    const session = await createSession(port, { name: 'Cancel', group: 'Tests', description: 'Cancel recovery' });
    const submit = await submitMessage(port, session.id, 'req-cancel', 'slow run for cancel');
    await waitForRunState(port, submit.json.run.id, 'running');

    const cancel = await request(port, 'POST', `/api/sessions/${session.id}/cancel`);
    assert.equal(cancel.status, 200, 'cancel request should succeed');

    const cancelledRun = await waitForRunTerminal(port, submit.json.run.id);
    assert.equal(cancelledRun.state, 'cancelled', 'cancelled run should reach terminal cancelled state');

    const retry = await submitMessage(port, session.id, 'req-cancel-retry', 'retry after cancel');
    const finalRun = await waitForRunTerminal(port, retry.json.run.id);
    assert.equal(finalRun.state, 'completed', 'session should accept a new run after cancel');
    console.log('phase8-cancel-recovery: ok');
  } finally {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
}

const phase = process.argv[2] || 'all';
const phases = {
  phase1: phase1Contract,
  phase2: phase2HttpCanonical,
  phase3: phase3Storage,
  phase4: phase4RunnerThin,
  phase5: phase5RestartSurvival,
  phase6: phase6WsInvalidationOnly,
  phase7: phase7EtagRevalidation,
  phase8: phase8CancelRecovery,
};

if (phase === 'all') {
  for (const key of Object.keys(phases)) {
    await phases[key]();
  }
} else if (phases[phase]) {
  await phases[phase]();
} else {
  console.error(`Unknown phase: ${phase}`);
  process.exit(1);
}
