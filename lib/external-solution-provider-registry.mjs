import { describeEvomapAvailability } from './external-solution-provider-config.mjs';
import { runEvomapAdapter } from './solution-providers/evomap.mjs';

const PROVIDERS = {
  evomap: {
    id: 'evomap',
    label: 'EvoMap',
    describeAvailability: describeEvomapAvailability,
    execute: runEvomapAdapter,
  },
};

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function listExternalSolutionProviders(options = {}) {
  return Object.values(PROVIDERS).map((provider) => ({
    id: provider.id,
    label: provider.label,
    ...provider.describeAvailability(options),
  }));
}

export function getExternalSolutionProvider(providerId) {
  const normalized = trimString(providerId).toLowerCase();
  return PROVIDERS[normalized] || null;
}

export async function executeExternalSolutionProvider(providerId, request = {}, options = {}) {
  const normalized = trimString(providerId).toLowerCase() || 'unknown';
  const provider = getExternalSolutionProvider(providerId);
  if (!provider) {
    return {
      ok: false,
      providerId: normalized,
      errorCategory: 'invalid_request',
      diagnostic: `unknown provider: ${providerId || '(missing)'}`,
    };
  }
  return provider.execute(request, options);
}
