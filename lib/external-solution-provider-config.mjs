import { homedir } from 'os';
import { join, resolve } from 'path';

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function envFlagEnabled(value, fallback = false) {
  const normalized = trimString(value).toLowerCase();
  if (!normalized) return fallback;
  return !['0', 'false', 'no', 'off'].includes(normalized);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveOverridePath(value) {
  const trimmed = trimString(value);
  if (!trimmed) return '';
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

export function getExternalSolutionProviderCacheRoot() {
  return resolveOverridePath(process.env.REMOTELAB_EXTERNAL_SOLUTION_PROVIDER_CACHE_DIR)
    || join(homedir(), '.cache', 'remotelab', 'external-solution-providers');
}

export function getEvomapConfig() {
  return {
    providerId: 'evomap',
    enabled: envFlagEnabled(process.env.REMOTELAB_EVOMAP_ENABLED, false),
    compatUrl: trimString(process.env.REMOTELAB_EVOMAP_COMPAT_URL),
    apiKey: trimString(process.env.REMOTELAB_EVOMAP_API_KEY),
    timeoutMs: parsePositiveInteger(process.env.REMOTELAB_EVOMAP_TIMEOUT_MS, 6000),
    uploadsEnabled: envFlagEnabled(process.env.REMOTELAB_EVOMAP_UPLOADS_ENABLED, false),
    fixtureFile: resolveOverridePath(process.env.REMOTELAB_EVOMAP_FIXTURE_FILE),
  };
}

export function describeEvomapAvailability(options = {}) {
  const config = getEvomapConfig();
  const hasFixture = !!(options?.fixtureFile || config.fixtureFile || options?.rawResponse);
  const hasCompatEndpoint = !!config.compatUrl;
  const available = hasFixture || (config.enabled && hasCompatEndpoint && !!config.apiKey);

  return {
    providerId: 'evomap',
    enabled: config.enabled,
    available,
    configured: hasFixture || (hasCompatEndpoint && !!config.apiKey),
    usesFixture: hasFixture,
    supportsUploads: config.uploadsEnabled,
    timeoutMs: config.timeoutMs,
  };
}
