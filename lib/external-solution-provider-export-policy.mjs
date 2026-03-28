import {
  normalizeCoverage,
  normalizeConfidence,
  normalizeActionability,
  normalizeStringList,
  trimString,
} from './external-solution-provider-contract.mjs';

const EXPORT_SCOPES = ['none', 'task_summary', 'local_summary'];

function nowIso() {
  return new Date().toISOString();
}

function normalizeExportScope(value, fallback = 'task_summary') {
  const normalized = trimString(value).toLowerCase().replace(/\s+/g, '_');
  if (!normalized) return fallback;
  if (normalized === 'task' || normalized === 'task_only') return 'task_summary';
  if (normalized === 'local' || normalized === 'local_retrieval' || normalized === 'local_retrieval_summary') return 'local_summary';
  return EXPORT_SCOPES.includes(normalized) ? normalized : fallback;
}

function sanitizeText(value, limit) {
  return trimString(value)
    .replace(/\s+/g, ' ')
    .slice(0, limit);
}

function sanitizeLocalRetrievalSummary(summary = {}) {
  const normalizedSummary = sanitizeText(summary?.overview || summary?.summary, 500);
  const gaps = normalizeStringList(summary?.gaps || summary?.limitations, { limit: 8, itemLimit: 200 });
  const evidenceRefs = normalizeStringList(summary?.evidenceRefs || summary?.sources, { limit: 8, itemLimit: 160 });
  return {
    coverage: normalizeCoverage(summary?.coverage, 'low'),
    confidence: normalizeConfidence(summary?.confidence, 'low'),
    actionability: normalizeActionability(summary?.actionability, 'low'),
    summary: normalizedSummary,
    gaps,
    evidenceRefs,
  };
}

export function buildProviderExportPack(input = {}) {
  const allowUpload = input?.allowUpload === true;
  const scope = normalizeExportScope(input?.allowedExportScope || input?.scope, allowUpload ? 'task_summary' : 'none');
  if (!allowUpload || scope === 'none') {
    return null;
  }

  const pack = {
    exportedAt: nowIso(),
    scope,
    redactionPolicy: 'minimal_task_pack',
    taskSummary: sanitizeText(input?.taskSummary, 800),
    domainHints: normalizeStringList(input?.domainHints, { limit: 8, itemLimit: 80 }),
    desiredOutputShape: sanitizeText(input?.desiredOutputShape, 160),
    locale: sanitizeText(input?.locale, 80),
    language: sanitizeText(input?.language, 80),
  };

  if (scope === 'local_summary') {
    pack.localRetrievalSummary = sanitizeLocalRetrievalSummary(input?.localRetrievalSummary);
  }

  return pack;
}

export function buildProviderExportRecord(input = {}) {
  const pack = input?.exportPack;
  if (!pack || typeof pack !== 'object') {
    return null;
  }

  const includedSections = [];
  if (pack.taskSummary) includedSections.push('taskSummary');
  if (Array.isArray(pack.domainHints) && pack.domainHints.length > 0) includedSections.push('domainHints');
  if (pack.desiredOutputShape) includedSections.push('desiredOutputShape');
  if (pack.locale) includedSections.push('locale');
  if (pack.language) includedSections.push('language');
  if (pack.localRetrievalSummary) includedSections.push('localRetrievalSummary');

  return {
    providerId: sanitizeText(input?.providerId, 80),
    exportedAt: pack.exportedAt || nowIso(),
    scope: normalizeExportScope(pack.scope, 'task_summary'),
    reason: sanitizeText(input?.reason || 'local_coverage_weak', 160),
    redactionPolicy: sanitizeText(pack.redactionPolicy || 'minimal_task_pack', 80),
    includedSections,
  };
}

export { normalizeExportScope };
