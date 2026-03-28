import assert from 'assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import http from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

const repoRoot = process.cwd();
const tempHome = mkdtempSync(join(tmpdir(), 'remotelab-agent-mail-command-'));
process.env.HOME = tempHome;

const mailboxRoot = join(tempHome, '.config', 'remotelab', 'agent-mailbox');

const { initializeMailbox, saveOutboundConfig } = await import('../lib/agent-mailbox.mjs');
const { runAgentMailCommand } = await import('../lib/agent-mail-command.mjs');

const requests = [];
const sockets = new Set();
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
  res.end(JSON.stringify({ id: 'msg_cli_123', message: 'queued' }));
});

server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

try {
  initializeMailbox({
    rootDir: mailboxRoot,
    name: 'Rowan',
    localPart: 'rowan',
    domain: 'example.com',
    allowEmails: ['owner@example.com'],
  });

  saveOutboundConfig(mailboxRoot, {
    provider: 'cloudflare_worker',
    workerBaseUrl: `http://127.0.0.1:${port}`,
    workerToken: 'cloudflare-worker-secret',
  });

  const draftPath = join(tempHome, 'draft.txt');
  writeFileSync(draftPath, 'Hello from the new mail command.\n', 'utf8');

  let sendStdout = '';
  const sendCode = await runAgentMailCommand([
    'send',
    '--root', mailboxRoot,
    '--to', 'recipient@example.com',
    '--subject', 'Mail command test',
    '--text-file', draftPath,
    '--json',
  ], {
    stdout: {
      write(chunk) {
        sendStdout += String(chunk);
      },
    },
  });

  assert.equal(sendCode, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/api/send-email');
  assert.equal(requests[0].headers.authorization, 'Bearer cloudflare-worker-secret');
  assert.deepEqual(JSON.parse(requests[0].body), {
    to: ['recipient@example.com'],
    from: 'rowan@example.com',
    subject: 'Mail command test',
    text: 'Hello from the new mail command.',
    inReplyTo: '',
    references: '',
  });

  const output = JSON.parse(sendStdout);
  assert.equal(output.provider, 'cloudflare_worker');
  assert.equal(output.to.length, 1);
  assert.equal(output.to[0], 'recipient@example.com');
  assert.equal(output.from, 'rowan@example.com');
  assert.equal(output.subject, 'Mail command test');
  assert.equal(output.responseId, 'msg_cli_123');
  assert.equal(output.responseMessage, 'queued');

  saveOutboundConfig(mailboxRoot, {
    provider: 'cloudflare_worker',
    workerBaseUrl: `http://127.0.0.1:${port}`,
    workerToken: 'cloudflare-worker-secret',
    from: 'existing@example.com',
  });

  let configStdout = '';
  const configCode = await runAgentMailCommand([
    'outbound',
    'configure-resend-api',
    '--root', mailboxRoot,
    '--from', 'agent@example.com',
    '--api-key-env', 'RESEND_API_KEY',
  ], {
    stdout: {
      write(chunk) {
        configStdout += String(chunk);
      },
    },
  });
  assert.equal(configCode, 0);
  assert.match(configStdout, /resend_api/);
  assert.match(configStdout, /RESEND_API_KEY/);

  const cliHelpResult = spawnSync(process.execPath, ['cli.js', 'mail', '--help'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: tempHome,
    },
    encoding: 'utf8',
  });
  assert.equal(cliHelpResult.status, 0, cliHelpResult.stderr);
  assert.match(cliHelpResult.stdout, /remotelab mail send/);
} finally {
  for (const socket of sockets) {
    socket.destroy();
  }
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

console.log('test-agent-mail-command: ok');
