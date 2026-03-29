#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

import {
  parseArgs,
  runEvomapGepCommand,
} from '../lib/evomap-gep-command.mjs';

const parsed = parseArgs([
  'publish',
  '--profile', 'hotel-housekeeping-analysis',
  '--version-tag', 'hackathon-v1',
  '--recipe-title', 'Hotel Ops Recipe',
  '--price', '9',
  '--max-concurrent', '2',
  '--skip-recipe',
  '--json',
]);
assert.equal(parsed.command, 'publish');
assert.equal(parsed.profileId, 'hotel-housekeeping-analysis');
assert.equal(parsed.versionTag, 'hackathon-v1');
assert.equal(parsed.recipeTitle, 'Hotel Ops Recipe');
assert.equal(parsed.pricePerExecution, 9);
assert.equal(parsed.maxConcurrent, 2);
assert.equal(parsed.skipRecipe, true);
assert.equal(parsed.json, true);

let stdout = '';
const code = await runEvomapGepCommand([
  'prepare',
  '--profile', 'hotel-housekeeping-analysis',
  '--version-tag', 'hackathon-v1',
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
assert.equal(payload.dryRun, true);
assert.equal(payload.profileId, 'hotel-housekeeping-analysis');
assert.equal(payload.assetBundle.assets.length, 2);
assert.equal(payload.recipeDraft.genes.length, 1);

const tempHome = mkdtempSync(join(tmpdir(), 'remotelab-evomap-gep-cli-'));
const cliResult = spawnSync(process.execPath, ['cli.js', 'evomap-gep', 'prepare', '--version-tag', 'hackathon-v1', '--json'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOME: tempHome,
  },
  encoding: 'utf8',
});
assert.equal(cliResult.status, 0, cliResult.stderr || cliResult.stdout);
const cliPayload = JSON.parse(cliResult.stdout);
assert.equal(cliPayload.dryRun, true);
assert.equal(cliPayload.profileId, 'hotel-housekeeping-analysis');

rmSync(tempHome, { recursive: true, force: true });

console.log('test-evomap-gep-command: ok');
