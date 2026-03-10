#!/usr/bin/env node

import {
  DEFAULT_ROOT_DIR,
  KNOWN_QUEUES,
  addAllowEntry,
  approveMessage,
  getMailboxStatus,
  initializeMailbox,
  ingestSource,
  listQueue,
  loadAllowlist,
  loadMailboxAutomation,
  loadOutboundConfig,
  mailboxPaths,
  queueCounts,
  saveMailboxAutomation,
  saveOutboundConfig,
  summarizeQueueItem,
} from '../lib/agent-mailbox.mjs';

function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const nextToken = argv[index + 1];
    const value = !nextToken || nextToken.startsWith('--') ? true : nextToken;
    if (value !== true) {
      index += 1;
    }

    if (Object.prototype.hasOwnProperty.call(options, key)) {
      const existingValue = options[key];
      options[key] = Array.isArray(existingValue)
        ? [...existingValue, value]
        : [existingValue, value];
    } else {
      options[key] = value;
    }
  }

  return { positional, options };
}

function optionValue(options, key, fallbackValue = undefined) {
  const value = options[key];
  if (Array.isArray(value)) {
    return value[value.length - 1];
  }
  return value === undefined ? fallbackValue : value;
}

function optionList(options, key) {
  const value = options[key];
  if (value === undefined || value === true) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function printUsage() {
  console.log(`Usage:
  node scripts/agent-mail.mjs init --name <name> --local-part <localPart> --domain <domain> [--allow <email>] [--allow-domain <domain>]
  node scripts/agent-mail.mjs status [--root <dir>]
  node scripts/agent-mail.mjs allow add <email-or-domain> [--root <dir>]
  node scripts/agent-mail.mjs allow list [--root <dir>]
  node scripts/agent-mail.mjs ingest --source <file-or-dir> [--root <dir>]
  node scripts/agent-mail.mjs queue [review|quarantine|approved] [--root <dir>]
  node scripts/agent-mail.mjs approve <id> [--reviewer <name>] [--root <dir>]
  node scripts/agent-mail.mjs outbound status [--root <dir>]
  node scripts/agent-mail.mjs outbound configure-forwardemail [--alias <email>] [--from <email>] [--api-token-env <ENV>] [--password-env <ENV>] [--api-base-url <url>] [--root <dir>]
  node scripts/agent-mail.mjs automation status [--root <dir>]
  node scripts/agent-mail.mjs automation configure [--chat-base-url <url>] [--folder <dir>] [--tool <tool>] [--group <name>] [--description <text>] [--system-prompt <text>] [--model <name>] [--effort <level>] [--thinking] [--root <dir>]

Examples:
  node scripts/agent-mail.mjs init --name Rowan --local-part rowan --domain jiujianian-dev-world.win --allow jiujianian@gmail.com
  node scripts/agent-mail.mjs ingest --source /tmp/mail-samples
  node scripts/agent-mail.mjs queue review
  node scripts/agent-mail.mjs approve mail_123 --reviewer jiujianian
  node scripts/agent-mail.mjs outbound configure-forwardemail --alias rowan@jiujianian.dev --password-env FORWARD_EMAIL_ALIAS_PASSWORD`);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  const rootDir = optionValue(options, 'root', DEFAULT_ROOT_DIR);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  if (command === 'init') {
    const result = initializeMailbox({
      rootDir,
      name: optionValue(options, 'name'),
      localPart: optionValue(options, 'local-part'),
      domain: optionValue(options, 'domain'),
      description: optionValue(options, 'description'),
      allowEmails: optionList(options, 'allow'),
      allowDomains: optionList(options, 'allow-domain'),
    });

    console.log(`Initialized mailbox identity at ${mailboxPaths(rootDir).identityFile}`);
    printJson({
      identity: result.identity,
      allowlist: result.allowlist,
    });
    return;
  }

  if (command === 'status') {
    printJson(getMailboxStatus(rootDir));
    return;
  }

  if (command === 'allow') {
    const action = positional[1];
    if (action === 'add') {
      const entry = positional[2];
      if (!entry) {
        throw new Error('allow add requires an email address or domain');
      }
      const allowlist = addAllowEntry(entry, rootDir);
      console.log(`Updated allowlist at ${mailboxPaths(rootDir).allowlistFile}`);
      printJson(allowlist);
      return;
    }

    if (action === 'list') {
      printJson(loadAllowlist(rootDir));
      return;
    }

    throw new Error('allow requires a subcommand: add | list');
  }

  if (command === 'ingest') {
    const sourcePath = optionValue(options, 'source');
    if (!sourcePath) {
      throw new Error('ingest requires --source <file-or-dir>');
    }

    const ingestedItems = ingestSource(sourcePath, rootDir).map(summarizeQueueItem);
    printJson({
      ingested: ingestedItems,
      counts: queueCounts(rootDir),
    });
    return;
  }

  if (command === 'queue') {
    const queueName = positional[1] || 'review';
    if (!KNOWN_QUEUES.includes(queueName)) {
      throw new Error(`queue must be one of: ${KNOWN_QUEUES.join(', ')}`);
    }

    printJson(listQueue(queueName, rootDir).map(summarizeQueueItem));
    return;
  }

  if (command === 'approve') {
    const id = positional[1];
    if (!id) {
      throw new Error('approve requires an item id');
    }

    const reviewer = optionValue(options, 'reviewer', 'manual-operator');
    printJson(summarizeQueueItem(approveMessage(id, rootDir, reviewer)));
    return;
  }

  if (command === 'outbound') {
    const action = positional[1] || 'status';
    if (action === 'status') {
      printJson(getMailboxStatus(rootDir).outbound);
      return;
    }

    if (action === 'configure-forwardemail') {
      const current = loadOutboundConfig(rootDir);
      const nextConfig = saveOutboundConfig(rootDir, {
        ...current,
        provider: 'forwardemail_api',
        alias: optionValue(options, 'alias', current.alias),
        from: optionValue(options, 'from', current.from),
        apiBaseUrl: optionValue(options, 'api-base-url', current.apiBaseUrl),
        apiToken: optionValue(options, 'api-token', current.apiToken),
        apiTokenEnv: optionValue(options, 'api-token-env', current.apiTokenEnv),
        password: optionValue(options, 'password', current.password),
        passwordEnv: optionValue(options, 'password-env', current.passwordEnv),
      });
      console.log(`Updated outbound config at ${mailboxPaths(rootDir).outboundFile}`);
      printJson(getMailboxStatus(rootDir).outbound);
      return;
    }

    throw new Error('outbound requires a subcommand: status | configure-forwardemail');
  }

  if (command === 'automation') {
    const action = positional[1] || 'status';
    if (action === 'status') {
      printJson(loadMailboxAutomation(rootDir));
      return;
    }

    if (action === 'configure') {
      const current = loadMailboxAutomation(rootDir);
      const nextAutomation = saveMailboxAutomation(rootDir, {
        ...current,
        enabled: optionValue(options, 'enabled', current.enabled) !== 'false',
        chatBaseUrl: optionValue(options, 'chat-base-url', current.chatBaseUrl),
        session: {
          ...current.session,
          folder: optionValue(options, 'folder', current.session.folder),
          tool: optionValue(options, 'tool', current.session.tool),
          group: optionValue(options, 'group', current.session.group),
          description: optionValue(options, 'description', current.session.description),
          systemPrompt: optionValue(options, 'system-prompt', current.session.systemPrompt),
          model: optionValue(options, 'model', current.session.model),
          effort: optionValue(options, 'effort', current.session.effort),
          thinking: optionValue(options, 'thinking', current.session.thinking) === true,
        },
      });
      console.log(`Updated automation config at ${mailboxPaths(rootDir).automationFile}`);
      printJson(nextAutomation);
      return;
    }

    throw new Error('automation requires a subcommand: status | configure');
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
