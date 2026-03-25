#!/usr/bin/env node

import { resolveMx } from 'dns/promises';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import net from 'net';
import { fileURLToPath } from 'url';

import {
  DEFAULT_ROOT_DIR,
  loadBridge,
  loadIdentity,
  loadOutboundConfig,
  normalizeInstanceAddressMode,
} from '../lib/agent-mailbox.mjs';

const DEFAULT_OWNER_CONFIG_DIR = join(homedir(), '.config', 'remotelab');
const DEFAULT_GUEST_REGISTRY_FILE = join(DEFAULT_OWNER_CONFIG_DIR, 'guest-instances.json');
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_WORKER_CONFIG_FILE = join(REPO_ROOT, 'cloudflare', 'email-worker', 'wrangler.jsonc');
const DEFAULT_CONNECT_TIMEOUT_MS = 15000;

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
    options[key] = value;
  }

  return { positional, options };
}

function optionValue(options, key, fallbackValue = undefined) {
  const value = options[key];
  return value === undefined ? fallbackValue : value;
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function printUsage(exitCode = 0) {
  const output = exitCode === 0 ? console.log : console.error;
  output(`Usage:
  node scripts/agent-mail-cloudflare-routing.mjs status [--root <dir>] [--zone <domain>] [--json]
  node scripts/agent-mail-cloudflare-routing.mjs probe --address <email> [--mx-host <host>] [--json]

Examples:
  node scripts/agent-mail-cloudflare-routing.mjs status --json
  node scripts/agent-mail-cloudflare-routing.mjs probe --address rowan@jiujianian.dev
  node scripts/agent-mail-cloudflare-routing.mjs probe --address trial6@jiujianian.dev --json

Notes:
  - This helper summarizes the desired Cloudflare Email Routing shape for RemoteLab guest-instance mailboxes.
  - It can do live SMTP RCPT probes, but it does not mutate Cloudflare dashboard state.
  - Cloudflare Email Routing API calls typically need a dedicated CLOUDFLARE_API_TOKEN; the OAuth token from \`wrangler login\` is not enough for \`/email/routing/*\` endpoints.`);
  process.exit(exitCode);
}

function readJson(filePath, fallbackValue) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallbackValue;
  }
}

function loadGuestRegistry(registryFile = DEFAULT_GUEST_REGISTRY_FILE) {
  const records = readJson(registryFile, []);
  if (!Array.isArray(records)) {
    return [];
  }
  return records
    .map((record) => ({
      name: trimString(record?.name),
      hostname: trimString(record?.hostname),
      publicBaseUrl: trimString(record?.publicBaseUrl),
      localBaseUrl: trimString(record?.localBaseUrl),
      mailboxAddress: trimString(record?.mailboxAddress),
    }))
    .filter((record) => record.name);
}

function loadWorkerConfig(workerConfigFile = DEFAULT_WORKER_CONFIG_FILE) {
  return readJson(workerConfigFile, null);
}

function buildGuestMailboxAddress(name, identity) {
  const normalizedName = trimString(name).toLowerCase();
  const localPart = trimString(identity?.localPart).toLowerCase();
  const domain = trimString(identity?.domain).toLowerCase();
  if (!normalizedName || !localPart || !domain) {
    return '';
  }

  const instanceAddressMode = normalizeInstanceAddressMode(identity?.instanceAddressMode);
  if (instanceAddressMode === 'local_part') {
    return `${normalizedName}@${domain}`;
  }
  return `${localPart}+${normalizedName}@${domain}`;
}

function buildStatusSummary({ rootDir = DEFAULT_ROOT_DIR, zone = '' } = {}) {
  const identity = loadIdentity(rootDir);
  const bridge = loadBridge(rootDir);
  const outbound = loadOutboundConfig(rootDir);
  const workerConfig = loadWorkerConfig();
  const guestInstances = loadGuestRegistry().map((record) => ({
    ...record,
    mailboxAddress: record.mailboxAddress || buildGuestMailboxAddress(record.name, identity),
  }));
  const domain = trimString(zone) || trimString(identity?.domain);
  const workerName = trimString(workerConfig?.name);
  const workerUrl = trimString(outbound?.workerBaseUrl);
  const publicWebhook = trimString(bridge?.cloudflareWebhook) || trimString(bridge?.publicWebhook);
  const instanceAddressMode = normalizeInstanceAddressMode(identity?.instanceAddressMode);

  const desiredAddresses = [
    trimString(identity?.address),
    ...guestInstances.map((record) => record.mailboxAddress),
  ].filter(Boolean);

  const manualSteps = [];
  if (domain && workerName) {
    manualSteps.push(`Cloudflare Dashboard -> ${domain} -> Email -> Email Routing -> Settings -> Email Workers -> select ${workerName}.`);
    manualSteps.push(`Cloudflare Dashboard -> ${domain} -> Email -> Email Routing -> Routes -> create a catch-all route that sends all inbound mail to ${workerName}.`);
    manualSteps.push(`Remove or deprioritize any literal-only route such as ${trimString(identity?.address) || 'rowan@example.com'} if it blocks catch-all delivery.`);
  }
  manualSteps.push('After the route change, run live probes for the owner mailbox and one guest mailbox before telling users the address is ready.');

  return {
    zone: domain,
    mailbox: {
      rootDir,
      ownerAddress: trimString(identity?.address),
      localPart: trimString(identity?.localPart),
      domain: trimString(identity?.domain),
      instanceAddressMode,
      exampleOwnerPlusAddress: trimString(identity?.localPart) && domain ? `${trimString(identity.localPart).toLowerCase()}+trial6@${domain}` : '',
      exampleGuestDirectAddress: domain ? `trial6@${domain}` : '',
    },
    cloudflare: {
      workerName,
      workerUrl,
      publicWebhook,
      desiredRouteModel: 'catch_all_to_email_worker',
      apiTokenConfigured: Boolean(trimString(process.env.CLOUDFLARE_API_TOKEN)),
      apiAuthNote: 'Use a dedicated CLOUDFLARE_API_TOKEN for /email/routing/* endpoints. The OAuth token from wrangler login is not sufficient.',
    },
    guestInstances,
    desiredAcceptedAddresses: desiredAddresses,
    manualSteps,
    validationCommands: desiredAddresses.slice(0, 3).map((address) => `node scripts/agent-mail-cloudflare-routing.mjs probe --address ${address}`),
  };
}

function printStatusSummary(summary, asJson = false) {
  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`Mailbox: ${summary.mailbox.ownerAddress || 'not initialized'}`);
  console.log(`Address mode: ${summary.mailbox.instanceAddressMode}`);
  if (summary.cloudflare.workerName) {
    console.log(`Worker: ${summary.cloudflare.workerName}`);
  }
  if (summary.cloudflare.workerUrl) {
    console.log(`Worker URL: ${summary.cloudflare.workerUrl}`);
  }
  if (summary.cloudflare.publicWebhook) {
    console.log(`Bridge webhook: ${summary.cloudflare.publicWebhook}`);
  }
  console.log(`Desired route model: ${summary.cloudflare.desiredRouteModel}`);
  console.log(`Cloudflare API note: ${summary.cloudflare.apiAuthNote}`);

  if (summary.guestInstances.length) {
    console.log('\nGuest instances:');
    for (const record of summary.guestInstances) {
      console.log(`- ${record.name}: ${record.mailboxAddress}`);
    }
  }

  console.log('\nManual steps:');
  for (const step of summary.manualSteps) {
    console.log(`- ${step}`);
  }

  console.log('\nValidation commands:');
  for (const command of summary.validationCommands) {
    console.log(`- ${command}`);
  }
}

function parseSmtpCode(line) {
  const match = String(line).match(/^(\d{3})([\s-])/);
  if (!match) {
    return { code: 0, finished: true };
  }
  return {
    code: Number.parseInt(match[1], 10),
    finished: match[2] === ' ',
  };
}

function waitForResponse(socket, bufferState) {
  return new Promise((resolve, reject) => {
    const tryConsume = () => {
      while (true) {
        const newlineIndex = bufferState.value.indexOf('\n');
        if (newlineIndex === -1) {
          return false;
        }
        const rawLine = bufferState.value.slice(0, newlineIndex + 1);
        bufferState.value = bufferState.value.slice(newlineIndex + 1);
        const line = rawLine.replace(/\r?\n$/, '');
        bufferState.lines.push(line);
        const parsed = parseSmtpCode(line);
        if (parsed.finished) {
          cleanup();
          resolve({ code: parsed.code, lines: [...bufferState.lines] });
          return true;
        }
      }
    };

    const onData = (chunk) => {
      bufferState.value += chunk.toString('utf8');
      tryConsume();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error('SMTP response timed out'));
    };
    const onClose = () => {
      cleanup();
      reject(new Error('SMTP connection closed unexpectedly'));
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
      socket.off('close', onClose);
    };

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('timeout', onTimeout);
    socket.on('close', onClose);
    tryConsume();
  });
}

async function readSmtpResponse(socket, transcript) {
  const bufferState = { value: '', lines: [] };
  const response = await waitForResponse(socket, bufferState);
  for (const line of response.lines) {
    transcript.push({ direction: 'recv', line });
  }
  return response;
}

async function sendSmtpCommand(socket, command, transcript) {
  transcript.push({ direction: 'send', line: command });
  socket.write(`${command}\r\n`);
}

async function smtpProbe(address, mxHost) {
  const targetAddress = trimString(address).toLowerCase();
  const atIndex = targetAddress.lastIndexOf('@');
  if (atIndex === -1) {
    throw new Error(`Invalid email address: ${address}`);
  }

  const domain = targetAddress.slice(atIndex + 1);
  const mxRecords = mxHost
    ? [{ exchange: trimString(mxHost), priority: 0 }]
    : (await resolveMx(domain)).sort((left, right) => left.priority - right.priority);
  const transcript = [];
  let lastError = null;

  for (const record of mxRecords) {
    const socket = new net.Socket();
    socket.setTimeout(DEFAULT_CONNECT_TIMEOUT_MS);
    try {
      await new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.connect(25, record.exchange, resolve);
      });

      const banner = await readSmtpResponse(socket, transcript);
      if (banner.code !== 220) {
        throw new Error(`Unexpected SMTP banner from ${record.exchange}: ${banner.lines.join(' | ')}`);
      }

      await sendSmtpCommand(socket, 'EHLO remotelab.local', transcript);
      await readSmtpResponse(socket, transcript);
      await sendSmtpCommand(socket, `MAIL FROM:<smtp-probe@${domain}>`, transcript);
      await readSmtpResponse(socket, transcript);
      await sendSmtpCommand(socket, `RCPT TO:<${targetAddress}>`, transcript);
      const rcpt = await readSmtpResponse(socket, transcript);
      await sendSmtpCommand(socket, 'QUIT', transcript);
      try {
        await readSmtpResponse(socket, transcript);
      } catch {
      }
      socket.end();

      return {
        address: targetAddress,
        mxHost: record.exchange,
        accepted: rcpt.code === 250 || rcpt.code === 251,
        code: rcpt.code,
        response: rcpt.lines.join(' | '),
        transcript,
      };
    } catch (error) {
      lastError = error;
      transcript.push({ direction: 'error', line: `${record.exchange}: ${error instanceof Error ? error.message : String(error)}` });
      socket.destroy();
    }
  }

  if (lastError) {
    return {
      address: targetAddress,
      mxHost: mxRecords[0]?.exchange || '',
      accepted: false,
      code: 0,
      response: lastError instanceof Error ? lastError.message : String(lastError),
      transcript,
    };
  }

  return {
    address: targetAddress,
    mxHost: '',
    accepted: false,
    code: 0,
    response: 'No MX hosts resolved',
    transcript,
  };
}

function printProbeResult(result, asJson = false) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Address: ${result.address}`);
  console.log(`MX host: ${result.mxHost || 'n/a'}`);
  console.log(`Accepted: ${result.accepted ? 'yes' : 'no'}`);
  console.log(`Response: ${result.response}`);
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (!command || command === '--help' || command === 'help') {
    printUsage(0);
  }

  if (command === 'status') {
    const summary = buildStatusSummary({
      rootDir: optionValue(options, 'root', DEFAULT_ROOT_DIR),
      zone: optionValue(options, 'zone', ''),
    });
    printStatusSummary(summary, optionValue(options, 'json', false) === true);
    return;
  }

  if (command === 'probe') {
    const address = optionValue(options, 'address', positional[1] || '');
    if (!address) {
      throw new Error('probe requires --address <email>');
    }

    const result = await smtpProbe(address, optionValue(options, 'mx-host', ''));
    printProbeResult(result, optionValue(options, 'json', false) === true);
    process.exit(result.accepted ? 0 : 1);
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
