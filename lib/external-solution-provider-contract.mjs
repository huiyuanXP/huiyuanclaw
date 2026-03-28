function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export const SOLUTION_PROVIDER_ERROR_CATEGORIES = [
  'auth_missing',
  'timeout',
  'transport_failed',
  'rate_limited',
  'invalid_request',
  'invalid_response',
  'provider_unavailable',
];

export const SOLUTION_PROVIDER_SOURCE_CHOICES = [
  'local_only',
  'local_plus_external',
  'external_only_fallback',
];

export const SOLUTION_PROVIDER_ROUTE_STATUSES = [
  'local_sufficient',
  'external_success',
  'external_partial',
  'external_failed',
  'skipped_policy',
  'skipped_provider_unavailable',
  'invalid_request',
];

export const COVERAGE_LEVELS = ['low', 'medium', 'high'];
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'];
export const ACTIONABILITY_LEVELS = ['low', 'medium', 'high'];
export const FRESHNESS_LEVELS = ['current', 'recent', 'stale', 'unknown'];

const COVERAGE_ALIASES = new Map([
  ['weak', 'low'],
  ['partial', 'medium'],
  ['moderate', 'medium'],
  ['strong', 'high'],
  ['full', 'high'],
]);

const CONFIDENCE_ALIASES = new Map([
  ['uncertain', 'low'],
  ['weak', 'low'],
  ['moderate', 'medium'],
  ['strong', 'high'],
]);

const ACTIONABILITY_ALIASES = new Map([
  ['weak', 'low'],
  ['partial', 'medium'],
  ['moderate', 'medium'],
  ['strong', 'high'],
  ['actionable', 'high'],
]);

const FRESHNESS_ALIASES = new Map([
  ['fresh', 'current'],
  ['new', 'current'],
  ['latest', 'current'],
  ['up_to_date', 'current'],
  ['up-to-date', 'current'],
  ['medium_term', 'recent'],
  ['mid_term', 'recent'],
  ['old', 'stale'],
]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeEnum(value, allowed, aliases, fallback) {
  const normalized = trimString(value).toLowerCase().replace(/\s+/g, '_');
  if (!normalized) return fallback;
  if (allowed.includes(normalized)) return normalized;
  if (aliases instanceof Map && aliases.has(normalized)) return aliases.get(normalized);
  return fallback;
}

function normalizeListValue(value, itemLimit = 120) {
  const normalized = trimString(value)
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.slice(0, itemLimit);
}

export function normalizeStringList(value, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 12;
  const itemLimit = Number.isInteger(options.itemLimit) && options.itemLimit > 0 ? options.itemLimit : 120;
  const list = Array.isArray(value)
    ? value
    : (typeof value === 'string'
      ? value.split(',')
      : []);

  const items = [];
  const seen = new Set();
  for (const item of list) {
    const normalized = normalizeListValue(item, itemLimit);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(normalized);
    if (items.length >= limit) break;
  }
  return items;
}

export function normalizeCoverage(value, fallback = 'low') {
  return normalizeEnum(value, COVERAGE_LEVELS, COVERAGE_ALIASES, fallback);
}

export function normalizeConfidence(value, fallback = 'low') {
  return normalizeEnum(value, CONFIDENCE_LEVELS, CONFIDENCE_ALIASES, fallback);
}

export function normalizeActionability(value, fallback = 'low') {
  if (value === true) return 'high';
  if (value === false) return 'low';
  return normalizeEnum(value, ACTIONABILITY_LEVELS, ACTIONABILITY_ALIASES, fallback);
}

export function normalizeFreshness(value, fallback = 'unknown') {
  return normalizeEnum(value, FRESHNESS_LEVELS, FRESHNESS_ALIASES, fallback);
}

export function normalizeSourceChoice(value, fallback = 'local_only') {
  return normalizeEnum(value, SOLUTION_PROVIDER_SOURCE_CHOICES, null, fallback);
}

export function normalizeRouteStatus(value, fallback = 'local_sufficient') {
  return normalizeEnum(value, SOLUTION_PROVIDER_ROUTE_STATUSES, null, fallback);
}

export function normalizeErrorCategory(value) {
  const normalized = trimString(value).toLowerCase();
  return SOLUTION_PROVIDER_ERROR_CATEGORIES.includes(normalized) ? normalized : '';
}

export function normalizeLatencyMs(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function clampRank(value, levels, fallback) {
  const normalized = normalizeEnum(value, levels, null, fallback);
  const index = levels.indexOf(normalized);
  return index >= 0 ? index : 0;
}

export function normalizeLocalRetrievalSummary(summary = {}) {
  const coverage = normalizeCoverage(summary?.coverage, 'low');
  const confidence = normalizeConfidence(summary?.confidence, 'low');
  const actionability = normalizeActionability(summary?.actionability, 'low');
  const overview = trimString(summary?.overview || summary?.summary).slice(0, 500);
  const gaps = normalizeStringList(summary?.gaps || summary?.limitations, { limit: 8, itemLimit: 160 });
  const evidenceRefs = normalizeStringList(summary?.evidenceRefs || summary?.sources, { limit: 8, itemLimit: 160 });
  const hasAnySignal = !!(overview || gaps.length || evidenceRefs.length || summary?.hasAnySignal === true);

  return {
    coverage,
    confidence,
    actionability,
    overview,
    gaps,
    evidenceRefs,
    hasAnySignal,
    strongEnough: isLocalRetrievalStrongEnough({ coverage, confidence, actionability }),
  };
}

export function isLocalRetrievalStrongEnough(summary = {}) {
  const coverageRank = clampRank(summary?.coverage, COVERAGE_LEVELS, 'low');
  const confidenceRank = clampRank(summary?.confidence, CONFIDENCE_LEVELS, 'low');
  const actionabilityRank = clampRank(summary?.actionability, ACTIONABILITY_LEVELS, 'low');
  return coverageRank >= 1 && confidenceRank >= 1 && actionabilityRank >= 1;
}

function normalizeWorkflowSkeleton(value, index) {
  if (typeof value === 'string') {
    const title = normalizeListValue(value, 200);
    return title
      ? { skeletonId: `workflow_${index + 1}`, title, steps: [] }
      : null;
  }
  if (!value || typeof value !== 'object') return null;

  const title = normalizeListValue(value.title || value.name || `Workflow ${index + 1}`, 200);
  const steps = normalizeStringList(value.steps || value.items, { limit: 12, itemLimit: 200 });
  const applicableScenarios = normalizeStringList(value.applicableScenarios || value.scenarios, { limit: 6, itemLimit: 120 });
  return title
    ? {
      skeletonId: normalizeListValue(value.skeletonId || value.id || `workflow_${index + 1}`, 80),
      title,
      steps,
      applicableScenarios,
    }
    : null;
}

export function normalizeEvidenceItem(item, index = 0) {
  const record = item && typeof item === 'object' ? item : {};
  const title = normalizeListValue(record.title || record.name || `Evidence ${index + 1}`, 200);
  const snippet = normalizeListValue(record.snippet || record.summary || record.text || record.description, 800);
  const sourceLabel = normalizeListValue(record.sourceLabel || record.source || record.sourceName || 'provider', 200);
  const sourceRef = normalizeListValue(record.sourceRef || record.url || record.ref || record.sourceUrl, 400);
  const provenanceType = normalizeListValue(record.provenanceType || record.type || 'provider_summary', 80) || 'provider_summary';

  return {
    itemId: normalizeListValue(record.itemId || record.id || `item_${index + 1}`, 80) || `item_${index + 1}`,
    title,
    snippet,
    sourceLabel,
    sourceRef,
    provenanceType,
    confidence: normalizeConfidence(record.confidence, 'medium'),
    freshness: normalizeFreshness(record.freshness, 'unknown'),
    applicableScenarios: normalizeStringList(record.applicableScenarios || record.scenarios, { limit: 6, itemLimit: 160 }),
    limitations: normalizeStringList(record.limitations || record.caveats, { limit: 6, itemLimit: 200 }),
    conflictFlags: normalizeStringList(record.conflictFlags || record.conflicts, { limit: 6, itemLimit: 120 }),
  };
}

export function normalizeEvidenceBundle(bundle = {}) {
  const evidenceItems = Array.isArray(bundle?.evidenceItems)
    ? bundle.evidenceItems.map((item, index) => normalizeEvidenceItem(item, index)).filter(Boolean)
    : [];
  const workflowSkeletons = Array.isArray(bundle?.workflowSkeletons)
    ? bundle.workflowSkeletons.map((item, index) => normalizeWorkflowSkeleton(item, index)).filter(Boolean)
    : [];

  return {
    route: 'external_fallback',
    providerId: normalizeListValue(bundle?.providerId || 'unknown', 80) || 'unknown',
    providerVersion: normalizeListValue(bundle?.providerVersion, 120),
    querySummary: trimString(bundle?.querySummary).slice(0, 500),
    domainHints: normalizeStringList(bundle?.domainHints, { limit: 8, itemLimit: 80 }),
    locale: normalizeListValue(bundle?.locale, 80),
    retrievedAt: trimString(bundle?.retrievedAt) || nowIso(),
    latencyMs: normalizeLatencyMs(bundle?.latencyMs),
    coverage: normalizeCoverage(bundle?.coverage, evidenceItems.length >= 3 ? 'high' : (evidenceItems.length >= 1 ? 'medium' : 'low')),
    confidence: normalizeConfidence(bundle?.confidence, evidenceItems.length >= 2 ? 'medium' : 'low'),
    freshness: normalizeFreshness(bundle?.freshness, 'unknown'),
    applicableScenarios: normalizeStringList(bundle?.applicableScenarios, { limit: 8, itemLimit: 160 }),
    limitations: normalizeStringList(bundle?.limitations, { limit: 8, itemLimit: 200 }),
    evidenceItems,
    workflowSkeletons,
    gaps: normalizeStringList(bundle?.gaps, { limit: 8, itemLimit: 200 }),
    writebackPolicy: 'manual_review_only',
  };
}

export { trimString };
