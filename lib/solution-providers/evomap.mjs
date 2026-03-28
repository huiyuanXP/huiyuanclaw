import { readFile } from 'fs/promises';

import { getEvomapConfig } from '../external-solution-provider-config.mjs';
import {
  normalizeCoverage,
  normalizeConfidence,
  normalizeEvidenceBundle,
  normalizeFreshness,
  normalizeStringList,
  trimString,
} from '../external-solution-provider-contract.mjs';

function buildRequestPayload(request = {}) {
  return {
    query: trimString(request?.taskSummary),
    domainHints: Array.isArray(request?.domainHints) ? request.domainHints : [],
    desiredOutputShape: trimString(request?.desiredOutputShape),
    locale: trimString(request?.locale),
    language: trimString(request?.language),
    policyConstraints: request?.policyConstraints || {},
    exportPack: request?.exportPack || null,
    latencyBudgetMs: request?.latencyBudgetMs || 0,
  };
}

function extractEvidenceItems(raw = {}) {
  if (Array.isArray(raw?.evidenceItems)) return raw.evidenceItems;
  if (Array.isArray(raw?.evidence)) return raw.evidence;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw?.results)) return raw.results;
  if (trimString(raw?.summary || raw?.answer)) {
    return [{
      title: raw?.title || 'Provider summary',
      snippet: raw?.summary || raw?.answer,
      sourceLabel: raw?.sourceLabel || 'evomap',
      sourceRef: raw?.sourceRef || raw?.url || '',
      provenanceType: 'provider_summary',
      confidence: raw?.confidence,
      freshness: raw?.freshness,
      applicableScenarios: raw?.applicableScenarios || raw?.scenarios,
      limitations: raw?.limitations || raw?.caveats,
    }];
  }
  return [];
}

function normalizeWorkflowSkeletons(raw = {}) {
  if (Array.isArray(raw?.workflowSkeletons)) return raw.workflowSkeletons;
  if (Array.isArray(raw?.workflowHints)) return raw.workflowHints;
  if (Array.isArray(raw?.playbooks)) return raw.playbooks;
  return [];
}

function normalizeLimitations(raw = {}) {
  return normalizeStringList(raw?.limitations || raw?.caveats || raw?.warnings, { limit: 8, itemLimit: 200 });
}

function normalizeGaps(raw = {}) {
  return normalizeStringList(raw?.gaps || raw?.unknowns || raw?.missingContext, { limit: 8, itemLimit: 200 });
}

function normalizeDomainHints(raw = {}, request = {}) {
  return normalizeStringList([
    ...(Array.isArray(request?.domainHints) ? request.domainHints : []),
    ...(Array.isArray(raw?.domainHints) ? raw.domainHints : []),
    ...(Array.isArray(raw?.domainTags) ? raw.domainTags : []),
    ...(Array.isArray(raw?.tags) ? raw.tags : []),
  ], { limit: 8, itemLimit: 80 });
}

function normalizeCoverageFromRaw(raw = {}, evidenceItems = []) {
  if (trimString(raw?.coverage)) return normalizeCoverage(raw.coverage, 'medium');
  if (evidenceItems.length >= 3) return 'high';
  if (evidenceItems.length >= 1) return 'medium';
  return 'low';
}

function normalizeConfidenceFromRaw(raw = {}, evidenceItems = []) {
  if (trimString(raw?.confidence)) return normalizeConfidence(raw.confidence, 'medium');
  if (evidenceItems.length >= 2) return 'medium';
  return 'low';
}

function mapStatusToErrorCategory(status) {
  if (status === 400) return 'invalid_request';
  if (status === 401 || status === 403) return 'auth_missing';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'invalid_response';
}

async function loadFixtureResponse(options = {}, config = {}) {
  if (options?.rawResponse && typeof options.rawResponse === 'object') {
    return options.rawResponse;
  }

  const filePath = trimString(options?.fixtureFile || config?.fixtureFile);
  if (!filePath) return null;

  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function normalizeEvomapResponse(raw = {}, request = {}, metadata = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('invalid_response');
  }

  const evidenceItems = extractEvidenceItems(raw);
  if (!Array.isArray(evidenceItems) || evidenceItems.length === 0) {
    throw new Error('invalid_response');
  }

  return normalizeEvidenceBundle({
    providerId: 'evomap',
    providerVersion: raw?.providerVersion || raw?.version || '',
    querySummary: trimString(request?.taskSummary),
    domainHints: normalizeDomainHints(raw, request),
    locale: trimString(request?.locale || request?.language),
    latencyMs: metadata?.latencyMs || 0,
    coverage: normalizeCoverageFromRaw(raw, evidenceItems),
    confidence: normalizeConfidenceFromRaw(raw, evidenceItems),
    freshness: normalizeFreshness(raw?.freshness, 'unknown'),
    applicableScenarios: normalizeStringList(raw?.applicableScenarios || raw?.scenarios, { limit: 8, itemLimit: 160 }),
    limitations: normalizeLimitations(raw),
    evidenceItems,
    workflowSkeletons: normalizeWorkflowSkeletons(raw),
    gaps: normalizeGaps(raw),
  });
}

function buildInvalidResult(diagnostic) {
  return {
    ok: false,
    providerId: 'evomap',
    errorCategory: 'invalid_request',
    diagnostic,
  };
}

export async function runEvomapAdapter(request = {}, options = {}) {
  const taskSummary = trimString(request?.taskSummary);
  if (!taskSummary) {
    return buildInvalidResult('task summary is required');
  }

  const config = getEvomapConfig();
  const startedAt = Date.now();

  try {
    const fixtureResponse = await loadFixtureResponse(options, config);
    if (fixtureResponse) {
      return {
        ok: true,
        providerId: 'evomap',
        evidenceBundle: normalizeEvomapResponse(fixtureResponse, request, {
          latencyMs: Date.now() - startedAt,
        }),
        diagnostic: 'fixture_response',
      };
    }
  } catch (error) {
    return {
      ok: false,
      providerId: 'evomap',
      errorCategory: error?.message === 'invalid_response' ? 'invalid_response' : 'transport_failed',
      diagnostic: error?.message || 'failed to load fixture response',
    };
  }

  if (!config.enabled || !config.compatUrl) {
    return {
      ok: false,
      providerId: 'evomap',
      errorCategory: 'provider_unavailable',
      diagnostic: 'evomap compat endpoint is not configured',
    };
  }

  if (!config.apiKey) {
    return {
      ok: false,
      providerId: 'evomap',
      errorCategory: 'auth_missing',
      diagnostic: 'evomap API key is missing',
    };
  }

  const timeoutMs = Number.isInteger(request?.latencyBudgetMs) && request.latencyBudgetMs > 0
    ? Math.min(request.latencyBudgetMs, config.timeoutMs)
    : config.timeoutMs;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(config.compatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildRequestPayload(request)),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        providerId: 'evomap',
        errorCategory: mapStatusToErrorCategory(response.status),
        diagnostic: `provider returned HTTP ${response.status}`,
      };
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      return {
        ok: false,
        providerId: 'evomap',
        errorCategory: 'invalid_response',
        diagnostic: 'provider response was not valid JSON',
      };
    }

    return {
      ok: true,
      providerId: 'evomap',
      evidenceBundle: normalizeEvomapResponse(payload, request, {
        latencyMs: Date.now() - startedAt,
      }),
      diagnostic: 'compat_endpoint',
    };
  } catch (error) {
    return {
      ok: false,
      providerId: 'evomap',
      errorCategory: error?.name === 'AbortError' ? 'timeout' : 'transport_failed',
      diagnostic: error?.message || 'provider request failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}
