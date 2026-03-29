#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  buildA2AMessageEnvelope,
  buildBuiltinEvomapRecipeProfile,
  computeEvomapAssetId,
  loadEvomapNodeConfig,
  runEvomapRecipePublishWorkflow,
  saveEvomapNodeConfig,
} from '../lib/evomap-gep-publisher.mjs';

const baseAsset = {
  type: 'Gene',
  schema_version: '1.5.0',
  id: 'gene_demo',
  category: 'optimize',
  signals_match: ['hotel'],
  strategy: ['step 1'],
  constraints: { max_files: 1, forbidden_paths: ['.git'] },
  validation: ['check'],
  model_name: 'gpt-5',
};
const sameAssetDifferentModel = {
  ...baseAsset,
  model_name: 'claude-sonnet-4',
};
assert.equal(computeEvomapAssetId(baseAsset), computeEvomapAssetId(sameAssetDifferentModel));

const profile = buildBuiltinEvomapRecipeProfile('hotel-housekeeping-analysis', {
  versionTag: 'hackathon-v1',
  recipeTitle: 'Hotel Ops Recipe',
  pricePerExecution: 7,
  maxConcurrent: 2,
});
assert.equal(profile.profileId, 'hotel-housekeeping-analysis');
assert.equal(profile.recipe.title, 'Hotel Ops Recipe');
assert.equal(profile.recipe.price_per_execution, 7);
assert.equal(profile.recipe.max_concurrent, 2);
assert.equal(profile.recipe.genes[0].gene_asset_id, profile.gene.asset_id);
assert.ok(profile.capsule.content.includes('Privacy rule:'));

const envelope = buildA2AMessageEnvelope('publish', 'node_demo', { assets: [] }, {
  messageId: 'msg_demo',
  timestamp: '2026-03-29T00:00:00.000Z',
});
assert.equal(envelope.protocol, 'gep-a2a');
assert.equal(envelope.message_type, 'publish');
assert.equal(envelope.sender_id, 'node_demo');

const tempHome = mkdtempSync(join(tmpdir(), 'remotelab-evomap-gep-'));
const originalHome = process.env.HOME;
process.env.HOME = tempHome;

try {
  await saveEvomapNodeConfig({
    nodeId: 'node_saved',
    nodeSecret: 'secret_saved',
    claimUrl: 'https://evomap.ai/claim/ABC',
  });
  const loaded = await loadEvomapNodeConfig();
  assert.equal(loaded.configured, true);
  assert.equal(loaded.nodeId, 'node_saved');
  assert.equal(loaded.nodeSecret, 'secret_saved');

  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith('/a2a/publish')) {
      return new Response(JSON.stringify({ status: 'acknowledged' }), { status: 200 });
    }
    if (String(url).endsWith('/a2a/recipe')) {
      return new Response(JSON.stringify({ recipe: { id: 'recipe_123', status: 'draft' } }), { status: 200 });
    }
    if (String(url).endsWith('/a2a/recipe/recipe_123/publish')) {
      return new Response(JSON.stringify({ recipe: { id: 'recipe_123', status: 'published' } }), { status: 200 });
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const workflow = await runEvomapRecipePublishWorkflow({
    profileId: 'hotel-housekeeping-analysis',
    versionTag: 'hackathon-v1',
    fetchImpl,
  });
  assert.equal(workflow.dryRun, false);
  assert.equal(workflow.node.nodeId, 'node_saved');
  assert.equal(workflow.bundle.publishStatus, 200);
  assert.equal(workflow.recipe.recipeId, 'recipe_123');
  assert.equal(requests.length, 3);
} finally {
  process.env.HOME = originalHome;
  rmSync(tempHome, { recursive: true, force: true });
}

console.log('test-evomap-gep-publisher: ok');
