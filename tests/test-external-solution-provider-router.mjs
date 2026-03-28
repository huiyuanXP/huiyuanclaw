#!/usr/bin/env node
import assert from 'assert/strict';

import {
  normalizeEvidenceBundle,
  normalizeLocalRetrievalSummary,
} from '../lib/external-solution-provider-contract.mjs';
import {
  buildProviderExportPack,
  buildProviderExportRecord,
} from '../lib/external-solution-provider-export-policy.mjs';
import { routeExternalSolutionProvider } from '../lib/external-solution-provider-router.mjs';

const strongLocal = normalizeLocalRetrievalSummary({
  coverage: 'high',
  confidence: 'high',
  actionability: 'medium',
  summary: 'We already have a usable local checklist.',
});
assert.equal(strongLocal.strongEnough, true);

const exportPack = buildProviderExportPack({
  allowUpload: true,
  allowedExportScope: 'local_summary',
  taskSummary: '  Help me build a hotel operations checklist.  ',
  domainHints: ['hotel', 'operations', 'hotel'],
  desiredOutputShape: '  checklist ',
  locale: ' zh-CN ',
  localRetrievalSummary: {
    coverage: 'low',
    confidence: 'medium',
    actionability: 'low',
    summary: 'We only have partial local notes.',
    gaps: ['No baseline SOP'],
    sources: ['local://notes/hotel-ops'],
  },
});
assert.equal(exportPack.scope, 'local_summary');
assert.equal(exportPack.redactionPolicy, 'minimal_task_pack');
assert.equal(exportPack.taskSummary, 'Help me build a hotel operations checklist.');
assert.deepEqual(exportPack.domainHints, ['hotel', 'operations']);
assert.equal(exportPack.localRetrievalSummary.coverage, 'low');
assert.deepEqual(exportPack.localRetrievalSummary.gaps, ['No baseline SOP']);

const exportRecord = buildProviderExportRecord({
  providerId: 'evomap',
  exportPack,
  reason: 'local_coverage_weak',
});
assert.equal(exportRecord.providerId, 'evomap');
assert.equal(exportRecord.scope, 'local_summary');
assert.ok(exportRecord.includedSections.includes('localRetrievalSummary'));

const bundle = normalizeEvidenceBundle({
  providerId: 'evomap',
  querySummary: 'Find a fallback workflow',
  domainHints: ['hotel'],
  evidenceItems: [{
    title: 'Baseline',
    snippet: 'Start from a short diagnostic pass.',
    sourceLabel: 'demo',
    sourceRef: 'demo://baseline',
  }],
});
assert.equal(bundle.providerId, 'evomap');
assert.equal(bundle.evidenceItems.length, 1);

const localOnly = await routeExternalSolutionProvider({
  providerId: 'evomap',
  taskSummary: 'Find a fallback workflow',
  domainHints: ['hotel'],
  localRetrievalSummary: {
    coverage: 'high',
    confidence: 'high',
    actionability: 'high',
    summary: 'Local pack is good enough.',
  },
});
assert.equal(localOnly.sourceChoice, 'local_only');
assert.equal(localOnly.routeStatus, 'local_sufficient');
assert.equal(localOnly.evidenceBundle, null);

const externalSuccess = await routeExternalSolutionProvider({
  providerId: 'evomap',
  taskSummary: 'Build a hotel review workflow',
  domainHints: ['hotel', 'operations'],
  desiredOutputShape: 'checklist',
  locale: 'zh-CN',
  language: 'zh',
  localRetrievalSummary: {
    coverage: 'low',
    confidence: 'low',
    actionability: 'low',
    summary: 'Local pack is thin.',
    gaps: ['Missing baseline review cadence'],
  },
  uploadPolicy: {
    allowUpload: true,
    allowedExportScope: 'local_summary',
  },
}, {
  rawResponse: {
    providerVersion: 'fixture',
    coverage: 'medium',
    confidence: 'medium',
    freshness: 'recent',
    evidenceItems: [
      {
        title: 'Review loop',
        snippet: 'Start with daily issue triage, then weekly trend review.',
        sourceLabel: 'fixture',
        sourceRef: 'fixture://review-loop',
        confidence: 'medium',
      },
      {
        title: 'Gap logging',
        snippet: 'Keep a visible gap list so follow-up data collection stays explicit.',
        sourceLabel: 'fixture',
        sourceRef: 'fixture://gap-logging',
      },
    ],
    workflowSkeletons: [{
      title: 'Hotel review cadence',
      steps: ['Review yesterday', 'Review weekly trend', 'Capture open gaps'],
    }],
  },
  cacheResult: false,
});
assert.equal(externalSuccess.sourceChoice, 'local_plus_external');
assert.equal(externalSuccess.routeStatus, 'external_success');
assert.equal(externalSuccess.evidenceBundle?.providerId, 'evomap');
assert.equal(externalSuccess.evidenceBundle?.evidenceItems.length, 2);
assert.equal(externalSuccess.exportRecord?.scope, 'local_summary');

const externalFailure = await routeExternalSolutionProvider({
  providerId: 'evomap',
  taskSummary: 'Build a hotel review workflow',
  domainHints: ['hotel'],
  localRetrievalSummary: {
    coverage: 'low',
    confidence: 'low',
    actionability: 'low',
  },
}, {
  rawResponse: {
    providerVersion: 'fixture',
    evidenceItems: [],
  },
  cacheResult: false,
});
assert.equal(externalFailure.routeStatus, 'external_failed');
assert.equal(externalFailure.errorCategory, 'invalid_response');

console.log('test-external-solution-provider-router: ok');
