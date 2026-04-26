import { readFileSync, existsSync } from 'fs';
import { UI_SETTINGS_FILE } from './config.mjs';

export const DEFAULT_CHAT_SETTINGS = {
  defaultTool: 'codex',
  codexModel: 'gpt-5.4',
  claudeModel: 'opus[1m]',
  namingTool: 'codex',
  namingModel: 'gpt-5.4-mini',
};

export const DEFAULT_AUTOMATION_SETTINGS = {
  workflowTool: 'codex',
  workflowModel: 'gpt-5.4',
  workflowForceModel: false,
  sessionMessageTool: 'inherit',
  sessionMessageModel: 'gpt-5.4',
  sessionMessageForceModel: false,
};

export const DEFAULT_AUTOMATION_OVERRIDES = {
  workflowOverrides: {},
  scheduleOverrides: {},
};

function mergeNamedOverrides(raw = {}, defaults = {}) {
  const merged = {};
  for (const [key, value] of Object.entries(raw || {})) {
    merged[key] = {
      ...defaults,
      ...(value || {}),
    };
  }
  return merged;
}

function mergeSettings(raw = {}) {
  return {
    ...raw,
    chatDefaults: {
      ...DEFAULT_CHAT_SETTINGS,
      ...(raw.chatDefaults || {}),
    },
    automationDefaults: {
      ...DEFAULT_AUTOMATION_SETTINGS,
      ...(raw.automationDefaults || {}),
    },
    automationOverrides: {
      ...DEFAULT_AUTOMATION_OVERRIDES,
      workflowOverrides: mergeNamedOverrides(raw.automationOverrides?.workflowOverrides),
      scheduleOverrides: mergeNamedOverrides(raw.automationOverrides?.scheduleOverrides),
    },
  };
}

export function loadRuntimeSettings() {
  try {
    if (!existsSync(UI_SETTINGS_FILE)) {
      return mergeSettings({});
    }
    const raw = JSON.parse(readFileSync(UI_SETTINGS_FILE, 'utf8'));
    return mergeSettings(raw);
  } catch {
    return mergeSettings({});
  }
}

export function getChatSettings() {
  return loadRuntimeSettings().chatDefaults;
}

export function getAutomationSettings() {
  return loadRuntimeSettings().automationDefaults;
}

export function getAutomationOverrides() {
  return loadRuntimeSettings().automationOverrides;
}
