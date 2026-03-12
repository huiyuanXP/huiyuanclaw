#!/usr/bin/env node
import assert from 'assert';
import http from 'http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';

const repoRoot = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), 'remotelab-share-'));
const homeDir = join(tempRoot, 'home');
const configDir = join(homeDir, '.config', 'remotelab');
const port = 7800 + Math.floor(Math.random() * 200);
const token = '0123456789abcdef'.repeat(4);
const base = `http://127.0.0.1:${port}`;

let server = null;

function request(method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers,
    }, (res) => {
      let chunks = '';
      res.on('data', (chunk) => {
        chunks += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: chunks });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForServer(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await request('GET', '/login');
      if (res.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for chat server');
}

function setupAuth() {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'auth.json'), JSON.stringify({ token }, null, 2), 'utf8');
}

function startServer() {
  server = spawn(process.execPath, ['chat-server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      CHAT_PORT: String(port),
      SECURE_COOKIES: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
  });
  server.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });
}

function stopServer() {
  if (!server || server.killed) return;
  server.kill('SIGTERM');
}

async function main() {
  setupAuth();
  startServer();
  await waitForServer();

  const authRes = await request('GET', `/?token=${token}`);
  assert.strictEqual(authRes.status, 302, 'token auth should redirect');
  const cookieHeader = authRes.headers['set-cookie'];
  assert.ok(cookieHeader && cookieHeader[0], 'auth should set a session cookie');
  const cookie = cookieHeader[0].split(';')[0];

  const createRes = await request('POST', '/api/sessions', {
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({ folder: homeDir, tool: 'codex' }),
  });
  assert.strictEqual(createRes.status, 201, 'session creation should succeed');
  const session = JSON.parse(createRes.body).session;
  assert.ok(session?.id, 'session id should exist');

  const historyDir = join(configDir, 'chat-history', session.id);
  mkdirSync(join(historyDir, 'events'), { recursive: true });
  mkdirSync(join(historyDir, 'bodies'), { recursive: true });
  writeFileSync(join(historyDir, 'meta.json'), JSON.stringify({
    latestSeq: 6,
    lastEventAt: 6,
    size: 6,
    counts: {
      message: 2,
      message_user: 1,
      message_assistant: 1,
      status: 1,
      reasoning: 1,
      tool_use: 1,
      tool_result: 1,
    },
  }, null, 2), 'utf8');
  const events = [
    {
      type: 'message',
      id: 'evt_000001',
      seq: 1,
      timestamp: 1,
      role: 'user',
      content: 'Please review this snippet.',
      bodyAvailable: true,
      bodyLoaded: true,
      images: [{
        filename: 'inline.png',
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0WQAAAAASUVORK5CYII=',
      }],
    },
    {
      type: 'status',
      id: 'evt_000002',
      seq: 2,
      timestamp: 2,
      role: 'system',
      content: 'thinking',
    },
    {
      type: 'reasoning',
      id: 'evt_000003',
      seq: 3,
      timestamp: 3,
      role: 'assistant',
      content: 'Need to inspect the data flow first.',
      bodyAvailable: true,
      bodyLoaded: true,
    },
    {
      type: 'tool_use',
      id: 'evt_000004',
      seq: 4,
      timestamp: 4,
      role: 'assistant',
      toolName: 'shell',
      toolInput: 'rg -n "share" .',
      bodyAvailable: true,
      bodyLoaded: true,
    },
    {
      type: 'tool_result',
      id: 'evt_000005',
      seq: 5,
      timestamp: 5,
      role: 'system',
      toolName: 'shell',
      output: 'chat/router.mjs: share route',
      exitCode: 0,
      bodyAvailable: true,
      bodyLoaded: true,
    },
    {
      type: 'message',
      id: 'evt_000006',
      seq: 6,
      timestamp: 6,
      role: 'assistant',
      content: 'Done.\n\n```js\nconsole.log("shared snapshot ok");\n```\n\n[external link](https://example.com)',
      bodyAvailable: true,
      bodyLoaded: true,
    },
  ];
  for (const event of events) {
    writeFileSync(
      join(historyDir, 'events', `${String(event.seq).padStart(9, '0')}.json`),
      JSON.stringify(event, null, 2),
      'utf8',
    );
  }

  stopServer();
  await new Promise((resolve) => setTimeout(resolve, 200));
  startServer();
  await waitForServer();

  const shareRes = await request('POST', `/api/sessions/${session.id}/share`, {
    headers: { Cookie: cookie },
  });
  assert.strictEqual(shareRes.status, 201, 'share creation should succeed');
  const sharePayload = JSON.parse(shareRes.body);
  assert.ok(/^\/share\/snap_[a-f0-9]{48}$/.test(sharePayload.share?.url || ''), 'share URL should be generated');

  const shareId = sharePayload.share.url.split('/').pop();
  const snapshotPath = join(configDir, 'shared-snapshots', `${shareId}.json`);
  assert.ok(existsSync(snapshotPath), 'snapshot file should be persisted');

  const storedSnapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  assert.strictEqual(storedSnapshot.id, shareId, 'snapshot id should match');
  assert.strictEqual(storedSnapshot.session.tool, 'codex', 'tool should be preserved');
  assert.ok(!JSON.stringify(storedSnapshot).includes('savedPath'), 'snapshot should not leak internal file paths');
  assert.ok(storedSnapshot.events.some((event) => event.type === 'message' && /Please review this snippet/.test(event.content || '')));
  assert.ok(storedSnapshot.events.some((event) => event.type === 'message' && /shared snapshot ok/.test(event.content || '')));

  const publicShareRes = await request('GET', sharePayload.share.url);
  assert.strictEqual(publicShareRes.status, 200, 'public share page should load without auth');
  assert.match(publicShareRes.headers['content-security-policy'] || '', /connect-src 'none'/, 'share page CSP should block network access');
  assert.strictEqual(publicShareRes.headers['referrer-policy'], 'no-referrer', 'share page should suppress referrer leakage');
  assert.match(publicShareRes.body, /Read-only snapshot/, 'share page should be read-only');
  assert.ok(!publicShareRes.body.includes('msgInput'), 'share page should not include live chat input');
  assert.ok(!publicShareRes.body.includes('/api/auth/me'), 'share page should not bootstrap owner auth UI');
  assert.ok(!publicShareRes.body.includes('/ws'), 'share page should not connect to live websocket');

  const unauthenticatedCaptureRes = await request('GET', `/capture/${session.id}`);
  assert.strictEqual(unauthenticatedCaptureRes.status, 302, 'capture view should require auth');

  const captureRes = await request('GET', `/capture/${session.id}`, {
    headers: { Cookie: cookie },
  });
  assert.strictEqual(captureRes.status, 200, 'capture view should load for the authenticated owner');
  assert.match(captureRes.headers['content-security-policy'] || '', /connect-src 'none'/, 'capture view CSP should block network access');
  assert.match(captureRes.headers['cache-control'] || '', /no-store/, 'capture view should not be cached');
  assert.ok(captureRes.body.includes('Optimized for long screenshots'), 'capture view should include the long-screenshot guidance');
  assert.ok(!captureRes.body.includes('msgInput'), 'capture view should not include live chat input');
  assert.ok(!captureRes.body.includes('/api/auth/me'), 'capture view should not bootstrap owner auth UI');
  assert.ok(!captureRes.body.includes('/ws'), 'capture view should not connect to live websocket');

  const missingRes = await request('GET', '/share/snap_deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  assert.strictEqual(missingRes.status, 404, 'missing share should return 404');

  console.log('✅ Share snapshot flow validated');
}

main()
  .catch((err) => {
    console.error('❌ Share snapshot test failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    stopServer();
    rmSync(tempRoot, { recursive: true, force: true });
  });
