import {
  listBuiltinEvomapRecipeProfiles,
  loadEvomapNodeConfig,
  runEvomapRecipePublishWorkflow,
} from './evomap-gep-publisher.mjs';

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function printHelp(stdout = process.stdout) {
  stdout.write(`Usage:\n  remotelab evomap-gep publish [options]\n  remotelab evomap-gep prepare [options]\n  remotelab evomap-gep status\n  remotelab evomap-gep profiles\n\nOptions:\n  --profile <id>           Built-in publish profile (default: hotel-housekeeping-analysis)\n  --version-tag <tag>      Version or release tag (default: v1)\n  --recipe-title <text>    Override recipe title\n  --price <credits>        Recipe price per execution (default: 5)\n  --max-concurrent <n>     Recipe max concurrency (default: 1)\n  --skip-recipe            Publish only Gene + Capsule, skip recipe creation\n  --dry-run                Generate payloads without calling EvoMap\n  --json                   Print machine-readable JSON\n  --help                   Show this help\n`);
}

export function parseArgs(argv = []) {
  const options = {
    command: 'publish',
    profileId: 'hotel-housekeeping-analysis',
    versionTag: 'v1',
    recipeTitle: '',
    pricePerExecution: 5,
    maxConcurrent: 1,
    skipRecipe: false,
    dryRun: false,
    json: false,
    help: false,
  };

  const args = Array.isArray(argv) ? [...argv] : [];
  if (args[0] && !args[0].startsWith('-')) {
    options.command = trimString(args.shift()) || 'publish';
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--skip-recipe') {
      options.skipRecipe = true;
      continue;
    }
    if (arg === '--profile') {
      options.profileId = trimString(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--version-tag') {
      options.versionTag = trimString(args[index + 1]) || 'v1';
      index += 1;
      continue;
    }
    if (arg === '--recipe-title') {
      options.recipeTitle = trimString(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--price') {
      options.pricePerExecution = parsePositiveInteger(args[index + 1], 5);
      index += 1;
      continue;
    }
    if (arg === '--max-concurrent') {
      options.maxConcurrent = parsePositiveInteger(args[index + 1], 1);
      index += 1;
    }
  }

  if (options.command === 'prepare') {
    options.dryRun = true;
  }

  return options;
}

function renderProfiles() {
  return `${listBuiltinEvomapRecipeProfiles().map((profile) => `${profile.id}\t${profile.description}`).join('\n')}\n`;
}

function renderStatus(status = {}) {
  return [
    `configured: ${status.configured ? 'yes' : 'no'}`,
    `nodeId: ${status.nodeId || ''}`,
    `claimUrl: ${status.claimUrl || ''}`,
    `configPath: ${status.configPath || ''}`,
  ].join('\n') + '\n';
}

function renderPublishResult(result = {}) {
  const lines = [
    `profile: ${result.profileId || ''}`,
    `releaseTag: ${result.releaseTag || ''}`,
  ];

  if (result.dryRun) {
    lines.push('mode: dry-run');
    lines.push(`geneAssetId: ${result.assetBundle?.assets?.[0]?.asset_id || ''}`);
    if (result.recipeDraft) lines.push(`recipeTitle: ${result.recipeDraft.title || ''}`);
    return `${lines.join('\n')}\n`;
  }

  lines.push(`nodeId: ${result.node?.nodeId || ''}`);
  if (result.node?.claimUrl) lines.push(`claimUrl: ${result.node.claimUrl}`);
  lines.push(`geneAssetId: ${result.bundle?.geneAssetId || ''}`);
  lines.push(`capsuleAssetId: ${result.bundle?.capsuleAssetId || ''}`);
  lines.push(`bundleStatus: ${result.bundle?.publishStatus || ''}`);
  if (result.recipe) {
    lines.push(`recipeId: ${result.recipe.recipeId || ''}`);
    lines.push(`recipeStatus: ${result.recipe.publishedStatus || result.recipe.createdStatus || ''}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function runEvomapGepCommand(argv = [], io = {}) {
  const stdout = io.stdout || process.stdout;
  const options = parseArgs(argv);

  if (options.help) {
    printHelp(stdout);
    return 0;
  }

  if (options.command === 'profiles') {
    stdout.write(renderProfiles());
    return 0;
  }

  if (options.command === 'status') {
    const status = await loadEvomapNodeConfig();
    if (options.json) {
      stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    } else {
      stdout.write(renderStatus(status));
    }
    return status.configured ? 0 : 1;
  }

  if (!['publish', 'prepare'].includes(options.command)) {
    throw new Error(`Unknown evomap-gep command: ${options.command}`);
  }

  const result = await runEvomapRecipePublishWorkflow(options);
  if (options.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    stdout.write(renderPublishResult(result));
  }
  return 0;
}

