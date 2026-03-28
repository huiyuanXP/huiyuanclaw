import { saveDisposableProviderSnapshot } from './external-solution-provider-cache.mjs';
import {
  buildProviderExportPack,
  buildProviderExportRecord,
} from './external-solution-provider-export-policy.mjs';
import {
  normalizeLocalRetrievalSummary,
  normalizeSourceChoice,
  normalizeStringList,
  trimString,
} from './external-solution-provider-contract.mjs';
import {
  executeExternalSolutionProvider,
  getExternalSolutionProvider,
} from './external-solution-provider-registry.mjs';

function resolveRouteStatusFromBundle(bundle = {}) {
  return bundle?.coverage === 'low' ? 'external_partial' : 'external_success';
}

function resolveSourceChoice(localRetrieval = {}, hasExternalEvidence = false) {
  if (!hasExternalEvidence) return 'local_only';
  if (localRetrieval?.hasAnySignal) return 'local_plus_external';
  return 'external_only_fallback';
}

export async function routeExternalSolutionProvider(input = {}, options = {}) {
  const taskSummary = trimString(input?.taskSummary || input?.question);
  const providerId = trimString(input?.providerId || 'evomap').toLowerCase() || 'evomap';
  const domainHints = normalizeStringList(input?.domainHints, { limit: 8, itemLimit: 80 });
  const localRetrieval = normalizeLocalRetrievalSummary(input?.localRetrievalSummary || {});
  const allowExternalProviders = input?.policyConstraints?.allowExternalProviders !== false;

  if (!taskSummary) {
    return {
      sourceChoice: 'local_only',
      routeStatus: 'invalid_request',
      errorCategory: 'invalid_request',
      providerId,
      domainHints,
      localRetrieval,
      evidenceBundle: null,
      exportRecord: null,
      providerAvailability: null,
      diagnostic: 'task summary is required',
    };
  }

  if (localRetrieval.strongEnough) {
    return {
      sourceChoice: 'local_only',
      routeStatus: 'local_sufficient',
      errorCategory: '',
      providerId,
      domainHints,
      localRetrieval,
      evidenceBundle: null,
      exportRecord: null,
      providerAvailability: null,
      diagnostic: 'local retrieval is strong enough',
    };
  }

  if (!allowExternalProviders) {
    return {
      sourceChoice: 'local_only',
      routeStatus: 'skipped_policy',
      errorCategory: '',
      providerId,
      domainHints,
      localRetrieval,
      evidenceBundle: null,
      exportRecord: null,
      providerAvailability: null,
      diagnostic: 'external providers disabled by policy',
    };
  }

  const provider = getExternalSolutionProvider(providerId);
  const providerAvailability = provider?.describeAvailability(options) || null;
  if (!provider || !providerAvailability?.available) {
    return {
      sourceChoice: 'local_only',
      routeStatus: 'skipped_provider_unavailable',
      errorCategory: '',
      providerId,
      domainHints,
      localRetrieval,
      evidenceBundle: null,
      exportRecord: null,
      providerAvailability,
      diagnostic: provider ? 'provider is not configured' : 'unknown provider',
    };
  }

  const allowUpload = input?.uploadPolicy?.allowUpload === true
    && (providerAvailability?.supportsUploads === true || !!options?.rawResponse || !!options?.fixtureFile);

  const exportPack = buildProviderExportPack({
    allowUpload,
    allowedExportScope: input?.uploadPolicy?.allowedExportScope,
    taskSummary,
    domainHints,
    desiredOutputShape: input?.desiredOutputShape,
    locale: input?.locale,
    language: input?.language,
    localRetrievalSummary: localRetrieval,
  });

  const exportRecord = buildProviderExportRecord({
    providerId,
    exportPack,
    reason: localRetrieval.hasAnySignal ? 'local_coverage_weak' : 'external_fallback_no_local_signal',
  });

  const providerResult = await executeExternalSolutionProvider(providerId, {
    taskSummary,
    domainHints,
    desiredOutputShape: trimString(input?.desiredOutputShape),
    locale: trimString(input?.locale),
    language: trimString(input?.language),
    policyConstraints: input?.policyConstraints || {},
    exportPack,
    latencyBudgetMs: Number.isInteger(input?.latencyBudgetMs) ? input.latencyBudgetMs : 12000,
  }, options);

  if (!providerResult?.ok) {
    return {
      sourceChoice: normalizeSourceChoice(resolveSourceChoice(localRetrieval, false)),
      routeStatus: 'external_failed',
      errorCategory: trimString(providerResult?.errorCategory),
      providerId,
      domainHints,
      localRetrieval,
      evidenceBundle: null,
      exportRecord,
      providerAvailability,
      diagnostic: trimString(providerResult?.diagnostic || 'external provider failed'),
    };
  }

  const evidenceBundle = providerResult.evidenceBundle;
  if (options?.cacheResult !== false) {
    await saveDisposableProviderSnapshot(providerId, {
      providerId,
      sourceChoice: resolveSourceChoice(localRetrieval, true),
      routeStatus: resolveRouteStatusFromBundle(evidenceBundle),
      exportRecord,
      evidenceBundle,
    }).catch(() => null);
  }

  return {
    sourceChoice: normalizeSourceChoice(resolveSourceChoice(localRetrieval, true)),
    routeStatus: resolveRouteStatusFromBundle(evidenceBundle),
    errorCategory: '',
    providerId,
    domainHints,
    localRetrieval,
    evidenceBundle,
    exportRecord,
    providerAvailability,
    diagnostic: trimString(providerResult?.diagnostic),
  };
}
