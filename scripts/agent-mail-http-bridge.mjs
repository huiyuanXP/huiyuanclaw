#!/usr/bin/env node

import { createServer } from 'http';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { ingestRawMessage, loadBridge, mailboxPaths, summarizeQueueItem } from '../lib/agent-mailbox.mjs';
import { assessForwardEmailSource, normalizeIp } from '../lib/agent-mail-http-bridge.mjs';

const HOST = process.env.AGENT_MAILBOX_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.AGENT_MAILBOX_PORT || '7694', 10);
const ROOT_DIR = process.env.AGENT_MAILBOX_ROOT || join(homedir(), '.config', 'remotelab', 'agent-mailbox');
const WEBHOOKS_DIR = join(ROOT_DIR, 'webhooks');
const EVENTS_FILE = join(ROOT_DIR, 'bridge-events.jsonl');
const MAX_BODY_BYTES = 12 * 1024 * 1024;

function nowIso() {
  return new Date().toISOString();
}

function ensureBridgePaths() {
  if (!existsSync(ROOT_DIR)) mkdirSync(ROOT_DIR, { recursive: true });
  if (!existsSync(WEBHOOKS_DIR)) mkdirSync(WEBHOOKS_DIR, { recursive: true });
}

function appendJsonl(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'a' });
}

function getClientIp(request) {
  const cfConnectingIp = request.headers['cf-connecting-ip'];
  if (cfConnectingIp) return normalizeIp(Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp);

  const forwardedFor = request.headers['x-forwarded-for'];
  if (forwardedFor) {
    const first = String(Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor).split(',')[0];
    return normalizeIp(first);
  }

  return normalizeIp(request.socket.remoteAddress || '');
}


function sendJson(response, statusCode, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error(`Webhook body exceeded ${MAX_BODY_BYTES} bytes`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function summarizePayload(payload) {
  return {
    sender: payload.sender || payload?.session?.envelope?.mailFrom?.address || '',
    recipient: payload?.session?.recipient || payload?.recipients?.[0] || '',
    subject: payload?.subject || payload?.headers?.subject || '',
    messageId: payload?.messageId || payload?.message_id || '',
  };
}

function recordExternalMailValidation(mailboxItem, sourceAssessment) {
  if (!sourceAssessment?.trusted || sourceAssessment.reason === 'loopback') {
    return;
  }

  const bridge = loadBridge(ROOT_DIR);
  if (!bridge) {
    return;
  }

  const validatedAt = nowIso();
  const nextBridge = {
    ...bridge,
    validation: {
      ...(bridge.validation || {}),
      queueReadyForRealMail: true,
      realExternalMailValidated: true,
      lastValidatedAt: validatedAt,
      lastExternalMailValidatedAt: validatedAt,
      lastExternalMail: summarizeQueueItem(mailboxItem),
      lastExternalSource: {
        ip: sourceAssessment.ip,
        matchedHostname: sourceAssessment.matchedHostname,
        reason: sourceAssessment.reason,
      },
    },
    updatedAt: validatedAt,
  };

  writeFileSync(mailboxPaths(ROOT_DIR).bridgeFile, `${JSON.stringify(nextBridge, null, 2)}\n`, 'utf8');
}

async function handleWebhook(request, response) {
  const clientIp = getClientIp(request);
  const sourceAssessment = await assessForwardEmailSource(clientIp);
  if (!sourceAssessment.trusted) {
    appendJsonl(EVENTS_FILE, {
      event: 'rejected_untrusted_source',
      createdAt: nowIso(),
      clientIp,
      sourceAssessment,
      path: request.url,
      method: request.method,
    });
    sendJson(response, 403, {
      ok: false,
      error: 'untrusted_source',
      clientIp,
      reason: sourceAssessment.reason,
    });
    return;
  }

  const bodyText = await readBody(request);
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    sendJson(response, 400, {
      ok: false,
      error: 'invalid_json',
    });
    return;
  }

  if (typeof payload.raw !== 'string' || !payload.raw.trim()) {
    sendJson(response, 400, {
      ok: false,
      error: 'missing_raw_email',
    });
    return;
  }

  ensureBridgePaths();
  const requestId = request.headers['cf-ray'] || `${Date.now()}`;
  const safeRequestId = String(Array.isArray(requestId) ? requestId[0] : requestId).replace(/[^a-zA-Z0-9._-]/g, '_');
  const webhookSnapshotPath = join(WEBHOOKS_DIR, `${safeRequestId}.json`);
  writeFileSync(webhookSnapshotPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const mailboxItem = ingestRawMessage(payload.raw, `forward-email:${safeRequestId}`, ROOT_DIR, {
    text: payload.text,
    html: payload.html,
  });
  recordExternalMailValidation(mailboxItem, sourceAssessment);
  appendJsonl(EVENTS_FILE, {
    event: 'accepted_forward_email_webhook',
    createdAt: nowIso(),
    clientIp,
    sourceAssessment,
    requestId: safeRequestId,
    webhookSnapshotPath,
    mailboxItem: summarizeQueueItem(mailboxItem),
    payload: summarizePayload(payload),
  });

  sendJson(response, 200, {
    ok: true,
    trustedSource: true,
    clientIp,
    webhookSnapshotPath,
    mailboxItem: summarizeQueueItem(mailboxItem),
  });
}

ensureBridgePaths();

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/healthz') {
      sendJson(response, 200, {
        ok: true,
        service: 'agent-mail-http-bridge',
        host: HOST,
        port: PORT,
        rootDir: ROOT_DIR,
        time: nowIso(),
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/forward-email/webhook') {
      await handleWebhook(request, response);
      return;
    }

    sendJson(response, 404, {
      ok: false,
      error: 'not_found',
      path: request.url,
    });
  } catch (error) {
    appendJsonl(EVENTS_FILE, {
      event: 'bridge_error',
      createdAt: nowIso(),
      message: error.message,
      stack: error.stack,
      path: request.url,
      method: request.method,
    });
    sendJson(response, 500, {
      ok: false,
      error: 'bridge_error',
      message: error.message,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[agent-mail-http-bridge] listening on http://${HOST}:${PORT}`);
  console.log(`[agent-mail-http-bridge] mailbox root ${ROOT_DIR}`);
});
