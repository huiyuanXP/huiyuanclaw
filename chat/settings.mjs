import { dirname } from 'path';
import { CHAT_SETTINGS_FILE } from '../lib/config.mjs';
import { createSerialTaskQueue, ensureDir, readJson, writeJsonAtomic } from './fs-utils.mjs';

const DEFAULTS = { progressEnabled: false };
const runSettingsMutation = createSerialTaskQueue();

async function loadSettings() {
  const loaded = await readJson(CHAT_SETTINGS_FILE, DEFAULTS);
  return { ...DEFAULTS, ...(loaded || {}) };
}

async function saveSettings(settings) {
  const dir = dirname(CHAT_SETTINGS_FILE);
  await ensureDir(dir);
  await writeJsonAtomic(CHAT_SETTINGS_FILE, settings);
}

export async function getSettings() {
  return loadSettings();
}

export async function updateSettings(patch) {
  return runSettingsMutation(async () => {
    const current = await loadSettings();
    const updated = { ...current, ...patch };
    await saveSettings(updated);
    return updated;
  });
}

export async function isProgressEnabled() {
  return (await loadSettings()).progressEnabled === true;
}
