#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import http from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

const repoRoot = process.cwd();
const tempHome = mkdtempSync(join(tmpdir(), 'remotelab-agent-mail-reply-'));
process.env.HOME = tempHome;

const mailboxRoot = join(tempHome, '.config', 'remotelab', 'agent-mailbox');
const workspace = join(tempHome, 'workspace');
mkdirSync(workspace, { recursive: true });

const {
  findQueueItem,
  initializeMailbox,
  ingestRawMessage,
  approveMessage,
  saveOutboundConfig,
} = await import(pathToFileURL(join(repoRoot, 'lib', 'agent-mailbox.mjs')).href);
const { createSession } = await import(pathToFileURL(join(repoRoot, 'chat', 'session-manager.mjs')).href);
const { appendEvent } = await import(pathToFileURL(join(repoRoot, 'chat', 'history.mjs')).href);
const { messageEvent } = await import(pathToFileURL(join(repoRoot, 'chat', 'normalizer.mjs')).href);
const { createRun } = await import(pathToFileURL(join(repoRoot, 'chat', 'runs.mjs')).href);
const { dispatchSessionCompletionTargets } = await import(pathToFileURL(join(repoRoot, 'chat', 'completion-targets.mjs')).href);

const requests = [];
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
  }
  requests.push({
    method: req.method,
    url: req.url,
    headers: req.headers,
    body,
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id: 'msg_123', message: 'queued' }));
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

  saveOutboundConfig(mailboxRoot, {
    provider: 'forwardemail_api',
    apiBaseUrl: `http://127.0.0.1:${port}/v1`,
    alias: 'rowan@jiujianian.dev',
    from: 'rowan@jiujianian.dev',
    password: 'secret-password',
  });

  const ingested = ingestRawMessage(
    [
      'From: jiujianian@gmail.com',
      'To: rowan@jiujianian.dev',
      'Subject: hello!',
      'Date: Tue, 10 Mar 2026 01:00:00 +0800',
      'Message-ID: <mail-test@example.com>',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'please take a response to test!',
    ].join('\n'),
    'test.eml',
    mailboxRoot,
    { text: 'please take a response to test!' },
  );

  const approved = approveMessage(ingested.id, mailboxRoot, 'tester');
  const requestId = `mailbox_reply_${approved.id}`;
  const session = await createSession(workspace, 'codex', 'Mail reply test', {
    completionTargets: [{
      type: 'email',
      requestId,
      to: 'jiujianian@gmail.com',
      subject: 'Re: hello!',
      mailboxRoot,
      mailboxItemId: approved.id,
    }],
  });
  const run = await createRun({
    status: {
      sessionId: session.id,
      requestId,
      state: 'completed',
      tool: 'codex',
    },
    manifest: {
      sessionId: session.id,
      requestId,
      folder: workspace,
      tool: 'codex',
      prompt: 'reply to the email',
      options: {},
    },
  });

  await appendEvent(session.id, messageEvent('assistant', 'Received — test successful.', undefined, {
    runId: run.id,
    requestId,
  }));

  const deliveries = await dispatchSessionCompletionTargets(session, run);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].state, 'sent');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/v1/emails');
  assert.match(requests[0].headers.authorization || '', /^Basic /);
  assert.match(requests[0].body, /to=jiujianian%40gmail\.com/);
  assert.match(requests[0].body, /subject=Re%3A\+hello%21/);
  assert.match(requests[0].body, /text=Received\+%E2%80%94\+test\+successful\./);

  const updated = findQueueItem(approved.id, mailboxRoot)?.item;
  assert.equal(updated?.status, 'reply_sent');
  assert.equal(updated?.automation?.status, 'reply_sent');
  assert.equal(updated?.automation?.runId, run.id);
  assert.equal(updated?.automation?.delivery?.provider, 'forwardemail_api');
} finally {
  server.close();
  rmSync(tempHome, { recursive: true, force: true });
}

console.log('agent mail reply tests passed');
