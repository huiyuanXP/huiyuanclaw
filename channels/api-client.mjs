/**
 * RemoteLab HTTP API client — used by channel adapters to talk to chat-server.
 * Same pattern as mcp-server.mjs.
 */

import http from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const AUTH_FILE = join(homedir(), '.config', 'claude-web', 'auth.json');

let authToken;
try {
  const auth = JSON.parse(readFileSync(AUTH_FILE, 'utf8'));
  authToken = auth.token;
} catch (err) {
  console.error(`[api-client] Failed to read auth token: ${err.message}`);
  process.exit(1);
}

const CHAT_PORT = parseInt(process.env.CHAT_PORT, 10) || 7690;
const BASE_URL = `http://127.0.0.1:${CHAT_PORT}`;

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---- Public API ----

export async function listSessions() {
  const { data } = await request('GET', '/api/sessions');
  return data?.sessions || data;
}

export async function getSession(id) {
  const { status, data } = await request('GET', `/api/sessions/${id}`);
  if (status === 404) return null;
  return data?.session || data;
}

export async function createSession(folder, tool = 'codex', name = '') {
  const { data } = await request('POST', '/api/sessions', { folder, tool, name });
  return data?.session || data;
}

export async function sendMessage(sessionId, text, options = {}) {
  const body = { text };
  if (options.tool) body.tool = options.tool;
  if (options.model) body.model = options.model;
  if (options.thinking !== undefined) body.thinking = options.thinking;
  const { data } = await request('POST', `/api/sessions/${sessionId}/messages`, body);
  return data;
}

export async function getHistory(sessionId) {
  const { data } = await request('GET', `/api/sessions/${sessionId}/history`);
  return data?.events || data;
}

export async function listFolders() {
  const { data } = await request('GET', '/api/folders');
  return data?.folders || data;
}
