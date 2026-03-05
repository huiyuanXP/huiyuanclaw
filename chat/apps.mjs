import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { APPS_FILE } from '../lib/config.mjs';

// ---- Persistence ----

function loadApps() {
  try {
    if (!existsSync(APPS_FILE)) return [];
    return JSON.parse(readFileSync(APPS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveApps(list) {
  const dir = dirname(APPS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(APPS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// ---- Public API ----

export function listApps() {
  return loadApps().filter(a => !a.deleted);
}

export function getApp(id) {
  return loadApps().find(a => a.id === id && !a.deleted) || null;
}

export function getAppByShareToken(shareToken) {
  if (!shareToken) return null;
  return loadApps().find(a => a.shareToken === shareToken && !a.deleted) || null;
}

export function createApp({ name, systemPrompt, welcomeMessage, skills, tool }) {
  const id = 'app_' + randomBytes(16).toString('hex');
  const shareToken = 'share_' + randomBytes(32).toString('hex');
  const app = {
    id,
    name: name || 'Untitled App',
    systemPrompt: systemPrompt || '',
    welcomeMessage: welcomeMessage || '',
    skills: skills || [],
    tool: tool || 'claude',
    shareToken,
    createdAt: new Date().toISOString(),
  };
  const apps = loadApps();
  apps.push(app);
  saveApps(apps);
  return app;
}

export function updateApp(id, updates) {
  const apps = loadApps();
  const idx = apps.findIndex(a => a.id === id && !a.deleted);
  if (idx === -1) return null;
  const allowed = ['name', 'systemPrompt', 'welcomeMessage', 'skills', 'tool'];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      apps[idx][key] = updates[key];
    }
  }
  apps[idx].updatedAt = new Date().toISOString();
  saveApps(apps);
  return apps[idx];
}

export function deleteApp(id) {
  const apps = loadApps();
  const idx = apps.findIndex(a => a.id === id && !a.deleted);
  if (idx === -1) return false;
  apps[idx].deleted = true;
  apps[idx].deletedAt = new Date().toISOString();
  saveApps(apps);
  return true;
}

export function regenerateShareToken(id) {
  const apps = loadApps();
  const idx = apps.findIndex(a => a.id === id && !a.deleted);
  if (idx === -1) return null;
  apps[idx].shareToken = 'share_' + randomBytes(32).toString('hex');
  saveApps(apps);
  return apps[idx];
}
