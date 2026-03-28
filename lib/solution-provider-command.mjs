import { readFile } from 'fs/promises';

import { routeExternalSolutionProvider } from './external-solution-provider-router.mjs';

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function printHelp(stdout = process.stdout) {
  stdout.write(`Usage:\n  remotelab solution-provider smoke [options]\n\nOptions:\n  --provider <id>           Provider id (default: evomap)\n  --task <text>             Task summary or question\n  --domain <tag>            Domain hint (repeatable)\n  --desired-output <text>   Desired output shape\n  --locale <value>          Locale hint\n  --language <value>        Language hint\n  --local-coverage <level>  low|medium|high (default: low)\n  --local-confidence <level> low|medium|high (default: low)\n  --local-actionability <level> low|medium|high (default: low)\n  --local-summary <text>    Local retrieval summary\n  --local-gap <text>        Local retrieval gap (repeatable)\n  --allow-upload            Allow a minimal redacted export pack\n  --export-scope <scope>    task_summary|local_summary\n  --fixture-file <path>     Load raw provider response JSON from a file\n  --demo                    Use a built-in demo provider response\n  --json                    Print machine-readable JSON\n  --help                    Show this help\n`);
}

function parseArgs(argv = []) {
  const options = {
    command: '',
    providerId: 'evomap',
    taskSummary: '',
    domainHints: [],
    desiredOutputShape: '',
    locale: '',
    language: '',
    localCoverage: 'low',
    localConfidence: 'low',
    localActionability: 'low',
    localSummary: '',
    localGaps: [],
    allowUpload: false,
    exportScope: 'task_summary',
    fixtureFile: '',
    demo: false,
    json: false,
    help: false,
  };

  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--provider':
        options.providerId = argv[index + 1] || options.providerId;
        index += 1;
        break;
      case '--task':
        options.taskSummary = argv[index + 1] || '';
        index += 1;
        break;
      case '--domain':
        options.domainHints.push(argv[index + 1] || '');
        index += 1;
        break;
      case '--desired-output':
        options.desiredOutputShape = argv[index + 1] || '';
        index += 1;
        break;
      case '--locale':
        options.locale = argv[index + 1] || '';
        index += 1;
        break;
      case '--language':
        options.language = argv[index + 1] || '';
        index += 1;
        break;
      case '--local-coverage':
        options.localCoverage = argv[index + 1] || options.localCoverage;
        index += 1;
        break;
      case '--local-confidence':
        options.localConfidence = argv[index + 1] || options.localConfidence;
        index += 1;
        break;
      case '--local-actionability':
        options.localActionability = argv[index + 1] || options.localActionability;
        index += 1;
        break;
      case '--local-summary':
        options.localSummary = argv[index + 1] || '';
        index += 1;
        break;
      case '--local-gap':
        options.localGaps.push(argv[index + 1] || '');
        index += 1;
        break;
      case '--allow-upload':
        options.allowUpload = true;
        break;
      case '--export-scope':
        options.exportScope = argv[index + 1] || options.exportScope;
        index += 1;
        break;
      case '--fixture-file':
        options.fixtureFile = argv[index + 1] || '';
        index += 1;
        break;
      case '--demo':
        options.demo = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        positional.push(arg);
        break;
    }
  }

  options.command = trimString(positional[0] || 'smoke').toLowerCase();
  options.providerId = trimString(options.providerId).toLowerCase() || 'evomap';
  options.taskSummary = trimString(options.taskSummary);
  options.desiredOutputShape = trimString(options.desiredOutputShape);
  options.locale = trimString(options.locale);
  options.language = trimString(options.language);
  options.localSummary = trimString(options.localSummary);
  options.fixtureFile = trimString(options.fixtureFile);
  options.domainHints = options.domainHints.map(trimString).filter(Boolean);
  options.localGaps = options.localGaps.map(trimString).filter(Boolean);

  return options;
}

async function loadFixtureFile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export function buildDemoProviderResponse(options = {}) {
  const domain = trimString(options?.domainHints?.[0] || 'operations');
  const locale = trimString(options?.locale || options?.language || 'en');
  return {
    providerVersion: 'demo-fixture',
    coverage: 'medium',
    confidence: 'medium',
    freshness: 'recent',
    domainHints: [domain],
    applicableScenarios: ['baseline workflow discovery', 'fallback domain framing'],
    limitations: ['Demo fixture only; replace with a live provider endpoint or captured fixture for real validation.'],
    gaps: ['Local company-specific metrics and sensitive records remain outside the export pack.'],
    evidenceItems: [
      {
        title: `${domain} workflow baseline`,
        snippet: `Start with a short diagnostic pass, define the outcome metric, and turn recurring decisions into a simple checklist for ${locale}.`,
        sourceLabel: 'evomap-demo',
        sourceRef: 'demo://workflow-baseline',
        provenanceType: 'workflow_hint',
        confidence: 'medium',
        freshness: 'recent',
        applicableScenarios: ['process review', 'early discovery'],
        limitations: ['Needs local validation before becoming durable knowledge.'],
      },
      {
        title: 'Evidence framing rule',
        snippet: 'Separate descriptive evidence, workflow hypotheses, and open gaps so later promotion can keep only de-identified abstractions.',
        sourceLabel: 'evomap-demo',
        sourceRef: 'demo://evidence-framing',
        provenanceType: 'provider_summary',
        confidence: 'medium',
        freshness: 'recent',
      },
    ],
    workflowSkeletons: [
      {
        title: 'Fallback discovery loop',
        steps: [
          'Summarize the task and missing local context.',
          'Query the external provider for baseline domain patterns.',
          'Return normalized evidence plus explicit gaps.',
          'Keep writeback disabled until a manual abstraction review.',
        ],
        applicableScenarios: ['new domain intake'],
      },
    ],
  };
}

function renderResult(result = {}) {
  const lines = [
    `provider: ${result.providerId || 'unknown'}`,
    `sourceChoice: ${result.sourceChoice || 'local_only'}`,
    `routeStatus: ${result.routeStatus || 'local_sufficient'}`,
  ];
  if (result.errorCategory) lines.push(`error: ${result.errorCategory}`);
  if (result.evidenceBundle) {
    lines.push(`coverage: ${result.evidenceBundle.coverage}`);
    lines.push(`confidence: ${result.evidenceBundle.confidence}`);
    lines.push(`evidenceItems: ${result.evidenceBundle.evidenceItems.length}`);
  }
  if (result.exportRecord) {
    lines.push(`exportScope: ${result.exportRecord.scope}`);
  }
  if (result.diagnostic) {
    lines.push(`diagnostic: ${result.diagnostic}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function runSolutionProviderCommand(argv = [], io = {}) {
  const stdout = io.stdout || process.stdout;
  const options = parseArgs(argv);

  if (options.help) {
    printHelp(stdout);
    return 0;
  }

  if (options.command !== 'smoke') {
    throw new Error(`Unknown solution-provider command: ${options.command}`);
  }

  if (!options.taskSummary) {
    throw new Error('--task is required');
  }

  let rawResponse = null;
  if (options.fixtureFile) {
    rawResponse = await loadFixtureFile(options.fixtureFile);
  } else if (options.demo) {
    rawResponse = buildDemoProviderResponse(options);
  }

  const result = await routeExternalSolutionProvider({
    providerId: options.providerId,
    taskSummary: options.taskSummary,
    domainHints: options.domainHints,
    desiredOutputShape: options.desiredOutputShape,
    locale: options.locale,
    language: options.language,
    localRetrievalSummary: {
      coverage: options.localCoverage,
      confidence: options.localConfidence,
      actionability: options.localActionability,
      summary: options.localSummary,
      gaps: options.localGaps,
    },
    uploadPolicy: {
      allowUpload: options.allowUpload,
      allowedExportScope: options.exportScope,
    },
    policyConstraints: {
      allowExternalProviders: true,
    },
  }, {
    rawResponse,
    fixtureFile: options.fixtureFile,
  });

  if (options.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    stdout.write(renderResult(result));
  }

  return result.errorCategory ? 1 : 0;
}

export { parseArgs };
