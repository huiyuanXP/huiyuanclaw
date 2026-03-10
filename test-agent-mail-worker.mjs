#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import http from 'http';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

const repoRoot = process.cwd();
const tempHome = mkdtempSync(join(tmpdir(), 'remotelab-agent-mail-worker-'));
process.env.HOME = tempHome;

const mailboxRoot = join(tempHome, '.config', 'remotelab', 'agent-mailbox');
mkdirSync(join(tempHome, '.config', 'remotelab'), { recursive: true });
writeFileSync(join(tempHome, '.config', 'remotelab', 'auth.json'), JSON.stringify({
  token: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
}, null, 2));

const {
  findQueueItem,
  initializeMailbox,
  ingestRawMessage,
  approveMessage,
  saveMailboxAutomation,
} = await import(pathToFileURL(join(repoRoot, 'lib', 'agent-mailbox.mjs')).href);

const requests = [];
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
  }
  requests.push({ method: req.method, url: req.url, headers: req.headers, body });

  if (req.method === 'GET' && req.url?.startsWith('/?token=')) {
    res.writeHead(302, {
      Location: '/',
      'Set-Cookie': 'session_token=test-cookie; HttpOnly; Path=/',
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/sessions') {
    const payload = JSON.parse(body || '{}');
    assert.equal(payload.externalTriggerId.startsWith('mailbox:'), true);
    assert.equal(Array.isArray(payload.completionTargets), true);
    assert.equal(payload.completionTargets.length, 1);
    assert.equal(payload.completionTargets[0].type, 'email');
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ session: { id: 'sess_1' } }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/sessions/sess_1/messages') {
    const payload = JSON.parse(body || '{}');
    assert.equal(payload.requestId.startsWith('mailbox_reply_'), true);
    assert.match(payload.text, /Original email:/);
    assert.match(payload.text, /please take a response to test!/);
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      duplicate: false,
      run: { id: 'run_1' },
      session: { id: 'sess_1' },
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

try {
  initializeMailbox({
    rootDir: mailboxRoot,
    name: 'Rowan',
    localPart: 'rowan',
    domain: 'jiujianian.dev',
    allowEmails: ['jiujianian@gmail.com'],
  });

  saveMailboxAutomation(mailboxRoot, {
    chatBaseUrl: `http://127.0.0.1:${port}`,
    session: {
      folder: '~',
      tool: 'codex',
      group: 'Mail',
      description: 'Inbound email',
      systemPrompt: 'Reply with plain text only.',
    },
  });

  const ingested = ingestRawMessage(
    [
      'From: jiujianian@gmail.com',
      'To: rowan@jiujianian.dev',
      'Subject: hello!',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'please take a response to test!',
    ].join('\n'),
    'test.eml',
    mailboxRoot,
    { text: 'please take a response to test!' },
  );
  const approved = approveMessage(ingested.id, mailboxRoot, 'tester');

  const worker = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(repoRoot, 'scripts', 'agent-mail-worker.mjs'), '--once', '--root', mailboxRoot], {
      cwd: repoRoot,
      env: { ...process.env, HOME: tempHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `worker exited with ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });

  const summary = JSON.parse(worker.stdout);
  assert.equal(summary.processed, 1);
  assert.equal(summary.failures.length, 0);
  assert.equal(requests.length, 3);

  const updated = findQueueItem(approved.id, mailboxRoot)?.item;
  assert.equal(updated?.status, 'processing_for_reply');
  assert.equal(updated?.automation?.status, 'processing_for_reply');
  assert.equal(updated?.automation?.sessionId, 'sess_1');
  assert.equal(updated?.automation?.runId, 'run_1');
} finally {
  server.close();
  rmSync(tempHome, { recursive: true, force: true });
}

console.log('agent mail worker tests passed');
