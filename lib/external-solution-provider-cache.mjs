import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

import { getExternalSolutionProviderCacheRoot } from './external-solution-provider-config.mjs';

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeProviderId(value) {
  const normalized = trimString(value).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return normalized || 'unknown';
}

export function resolveProviderCacheDir(providerId) {
  return join(getExternalSolutionProviderCacheRoot(), sanitizeProviderId(providerId));
}

export async function saveDisposableProviderSnapshot(providerId, snapshot = {}, options = {}) {
  const dir = resolveProviderCacheDir(providerId);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, trimString(options.fileName) || 'latest.json');
  await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return filePath;
}
