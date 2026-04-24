import { readdir, readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

const CLAUDE_MODELS = [
  { id: 'sonnet', label: 'Sonnet 4.6' },
  { id: 'opus', label: 'Opus 4.6' },
  { id: 'haiku', label: 'Haiku 4.5' },
];

let codexModelsCache = null;
let claudeModelsCache = null;

export async function getModelsForTool(toolId) {
  if (toolId === 'claude') {
    return getClaudeModels();
  }

  if (toolId === 'codex') {
    return getCodexModels();
  }

  return {
    models: [],
    effortLevels: null,
    defaultModel: null,
    reasoning: { kind: 'none', label: 'Thinking' },
  };
}

async function getClaudeModels() {
  if (claudeModelsCache) {
    return claudeModelsCache;
  }

  const discoveredModels = await discoverClaudeModels();
  const aliasModels = [...CLAUDE_MODELS];
  const merged = [...aliasModels];
  const seen = new Set(aliasModels.map((model) => model.id));

  for (const model of discoveredModels) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    merged.push(model);
  }

  claudeModelsCache = {
    models: merged,
    effortLevels: null,
    defaultModel: null,
    reasoning: { kind: 'toggle', label: 'Thinking' },
  };
  return claudeModelsCache;
}

async function discoverClaudeModels() {
  const discovered = new Map();

  for (const model of await readClaudeStatsModels()) {
    discovered.set(model.id, model);
  }

  for (const model of await readClaudeSessionModels()) {
    if (!discovered.has(model.id)) {
      discovered.set(model.id, model);
    }
  }

  return [...discovered.values()];
}

async function readClaudeStatsModels() {
  try {
    const raw = await readFile(join(homedir(), '.claude', 'stats-cache.json'), 'utf-8');
    const stats = JSON.parse(raw);
    const ids = new Set();
    for (const entry of stats.dailyModelTokens || []) {
      for (const modelId of Object.keys(entry.tokensByModel || {})) {
        if (isClaudeFullModelId(modelId)) ids.add(modelId);
      }
    }
    return [...ids].map((id) => ({ id, label: formatClaudeModelLabel(id) }));
  } catch {
    return [];
  }
}

async function readClaudeSessionModels() {
  const sessionRoot = join(homedir(), '.claude', 'projects');
  try {
    const projectDirs = await readdir(sessionRoot, { withFileTypes: true });
    const recentFiles = [];
    for (const projectDir of projectDirs.slice(-20)) {
      if (!projectDir.isDirectory()) continue;
      const projectPath = join(sessionRoot, projectDir.name);
      const names = await readdir(projectPath);
      for (const name of names) {
        if (name.endsWith('.jsonl')) {
          recentFiles.push(join(projectPath, name));
        }
      }
    }
    const ids = new Set();
    for (const filePath of recentFiles.slice(-60)) {
      try {
        const text = await readFile(filePath, 'utf-8');
        for (const line of text.split('\n')) {
          if (!line.includes('"model"')) continue;
          try {
            const entry = JSON.parse(line);
            const modelId = entry?.message?.model;
            if (isClaudeFullModelId(modelId)) ids.add(modelId);
          } catch {}
        }
      } catch {}
    }
    return [...ids].map((id) => ({ id, label: formatClaudeModelLabel(id) }));
  } catch {
    return [];
  }
}

function isClaudeFullModelId(value) {
  return /^claude-(sonnet|opus|haiku)-/i.test(String(value || '').trim());
}

function formatClaudeModelLabel(modelId) {
  const normalized = String(modelId || '').trim();
  const aliasMatch = normalized.match(/^claude-(sonnet|opus|haiku)-(\d)-(\d)/i);
  if (aliasMatch) {
    const [, family, major, minor] = aliasMatch;
    const familyLabel = family.charAt(0).toUpperCase() + family.slice(1).toLowerCase();
    return `${familyLabel} ${major}.${minor}`;
  }
  return normalized;
}

async function getCodexModels() {
  if (codexModelsCache) {
    return codexModelsCache;
  }

  try {
    const raw = await readFile(join(homedir(), '.codex', 'models_cache.json'), 'utf-8');
    const data = JSON.parse(raw);
    const models = (data.models || [])
      .filter((model) => model.visibility === 'list')
      .map((model) => ({
        id: model.slug,
        label: model.display_name,
        defaultEffort: model.default_reasoning_level || 'medium',
        effortLevels: (model.supported_reasoning_levels || []).map((level) => level.effort),
      }));
    const effortLevels = [...new Set(models.flatMap((model) => model.effortLevels || []))];

    codexModelsCache = {
      models,
      effortLevels,
      defaultModel: null,
      reasoning: {
        kind: 'enum',
        label: 'Thinking',
        levels: effortLevels,
        default: models[0]?.defaultEffort || effortLevels[0] || 'medium',
      },
    };
    return codexModelsCache;
  } catch {
    codexModelsCache = {
      models: [],
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultModel: null,
      reasoning: {
        kind: 'enum',
        label: 'Thinking',
        levels: ['low', 'medium', 'high', 'xhigh'],
        default: 'medium',
      },
    };
    return codexModelsCache;
  }
}
