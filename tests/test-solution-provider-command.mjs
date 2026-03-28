#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

import {
  buildDemoProviderResponse,
  parseArgs,
  runSolutionProviderCommand,
} from '../lib/solution-provider-command.mjs';

const tempHome = mkdtempSync(join(tmpdir(), 'remotelab-solution-provider-command-'));
const originalHome = process.env.HOME;
process.env.HOME = tempHome;

try {
  const parsed = parseArgs([
    'smoke',
    '--provider', 'evomap',
    '--task', 'Build a hotel review workflow',
    '--domain', 'hotel',
    '--domain', 'operations',
    '--desired-output', 'checklist',
    '--locale', 'zh-CN',
    '--local-coverage', 'low',
    '--local-confidence', 'medium',
    '--local-actionability', 'low',
    '--local-summary', 'Local material is thin.',
    '--local-gap', 'No standard checklist',
    '--allow-upload',
    '--export-scope', 'local_summary',
    '--demo',
    '--json',
  ]);
  assert.equal(parsed.command, 'smoke');
  assert.equal(parsed.providerId, 'evomap');
  assert.deepEqual(parsed.domainHints, ['hotel', 'operations']);
  assert.equal(parsed.allowUpload, true);
  assert.equal(parsed.exportScope, 'local_summary');
  assert.equal(parsed.demo, true);

  const demo = buildDemoProviderResponse(parsed);
  assert.equal(demo.providerVersion, 'demo-fixture');
  assert.equal(demo.evidenceItems.length, 2);

  let stdout = '';
  const code = await runSolutionProviderCommand([
    'smoke',
    '--task', 'Build a hotel review workflow',
    '--domain', 'hotel',
    '--desired-output', 'checklist',
    '--local-summary', 'Local material is thin.',
    '--local-gap', 'No standard checklist',
    '--allow-upload',
    '--export-scope', 'local_summary',
    '--demo',
    '--json',
  ], {
    stdout: {
      write(chunk) {
        stdout += String(chunk);
      },
    },
  });

  assert.equal(code, 0);
  const payload = JSON.parse(stdout);
  assert.equal(payload.providerId, 'evomap');
  assert.equal(payload.sourceChoice, 'local_plus_external');
  assert.equal(payload.routeStatus, 'external_success');
  assert.equal(payload.exportRecord.scope, 'local_summary');
  assert.equal(payload.evidenceBundle.evidenceItems.length, 2);

  const cliResult = spawnSync(process.execPath, ['cli.js', 'solution-provider', 'smoke', '--task', 'Build a hotel review workflow', '--domain', 'hotel', '--demo', '--json'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: tempHome,
    },
    encoding: 'utf8',
  });
  assert.equal(cliResult.status, 0, cliResult.stderr || cliResult.stdout);
  const cliPayload = JSON.parse(cliResult.stdout);
  assert.equal(cliPayload.providerId, 'evomap');
  assert.equal(cliPayload.sourceChoice, 'external_only_fallback');
  assert.equal(cliPayload.routeStatus, 'external_success');
} finally {
  process.env.HOME = originalHome;
  rmSync(tempHome, { recursive: true, force: true });
}

console.log('test-solution-provider-command: ok');
