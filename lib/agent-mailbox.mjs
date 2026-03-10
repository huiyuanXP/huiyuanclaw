import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, renameSync } from 'fs';
import { homedir } from 'os';
import { basename, join } from 'path';
import { summarizeOutboundConfig } from './agent-mail-outbound.mjs';

const DEFAULT_ROOT_DIR = join(homedir(), '.config', 'remotelab', 'agent-mailbox');
const REVIEW_QUEUE = 'review';
const QUARANTINE_QUEUE = 'quarantine';
const APPROVED_QUEUE = 'approved';
const KNOWN_QUEUES = [REVIEW_QUEUE, QUARANTINE_QUEUE, APPROVED_QUEUE];
const DEFAULT_OUTBOUND_CONFIG = {
  provider: 'forwardemail_api',
  apiBaseUrl: 'https://api.forwardemail.net/v1',
  alias: '',
  from: '',
  apiToken: '',
  apiTokenEnv: 'FORWARD_EMAIL_API_TOKEN',
  password: '',
  passwordEnv: 'FORWARD_EMAIL_ALIAS_PASSWORD',
};
const DEFAULT_AUTOMATION_SETTINGS = {
  enabled: true,
  chatBaseUrl: 'http://127.0.0.1:7690',
  session: {
    folder: '~',
    tool: 'codex',
    group: 'Mail',
    description: 'Inbound agent mailbox conversations.',
    thinking: false,
    model: '',
    effort: '',
    systemPrompt: 'You are replying to an inbound email as Rowan. Write the exact plain-text email reply body to send back. Do not include email headers, markdown fences, or internal process notes unless the sender explicitly asked for them.',
  },
};
const FORWARD_EMAIL_FREE_TLDS = new Set([
  'ac', 'ad', 'ag', 'ai', 'al', 'am', 'app', 'as', 'at', 'au', 'ax', 'ba', 'be', 'bg', 'br', 'by', 'bzh',
  'ca', 'cat', 'cc', 'cd', 'ch', 'ck', 'co', 'com', 'de', 'dev', 'dj', 'dk', 'ee', 'es', 'eu', 'family',
  'fi', 'fm', 'fo', 'fr', 'gf', 'gg', 'gi', 'gl', 'gp', 'gr', 'hr', 'hu', 'id', 'ie', 'il', 'im', 'in',
  'io', 'ir', 'is', 'it', 'je', 'jp', 'ke', 'kr', 'la', 'li', 'lt', 'lu', 'lv', 'ly', 'mc', 'md', 'me',
  'mk', 'mn', 'mq', 'ms', 'mt', 'mu', 'mx', 'nc', 'net', 'ni', 'nl', 'no', 'nu', 'nz', 'org', 'pf', 'pl',
  'pm', 'pr', 'pt', 'pw', 're', 'ro', 'rs', 'sc', 'se', 'sh', 'si', 'sk', 'sm', 'sr', 'st', 'tc', 'tf',
  'tm', 'to', 'tv', 'uk', 'us', 'uz', 'va', 'vc', 'vg', 'vu', 'wf', 'ws', 'xyz', 'yt', 'za',
]);

function mailboxPaths(rootDir = DEFAULT_ROOT_DIR) {
  return {
    rootDir,
    identityFile: join(rootDir, 'identity.json'),
    allowlistFile: join(rootDir, 'allowlist.json'),
    bridgeFile: join(rootDir, 'bridge.json'),
    outboundFile: join(rootDir, 'outbound.json'),
    automationFile: join(rootDir, 'automation.json'),
    eventsFile: join(rootDir, 'events.jsonl'),
    rawDir: join(rootDir, 'raw'),
    reviewDir: join(rootDir, REVIEW_QUEUE),
    quarantineDir: join(rootDir, QUARANTINE_QUEUE),
    approvedDir: join(rootDir, APPROVED_QUEUE),
  };
}

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

function ensureMailboxRoot(rootDir = DEFAULT_ROOT_DIR) {
  const paths = mailboxPaths(rootDir);
  ensureDirectory(paths.rootDir);
  ensureDirectory(paths.rawDir);
  ensureDirectory(paths.reviewDir);
  ensureDirectory(paths.quarantineDir);
  ensureDirectory(paths.approvedDir);
  return paths;
}

function readJson(filePath, fallbackValue) {
  if (!existsSync(filePath)) {
    return fallbackValue;
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function appendJsonl(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'a' });
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmailAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDomain(value) {
  return normalizeEmailAddress(value).replace(/^@+/, '');
}

function topLevelDomain(value) {
  const labels = normalizeDomain(value).split('.').filter(Boolean);
  return labels.length ? labels[labels.length - 1] : '';
}

function dedupeSorted(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function deepClone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function mergeAutomationSettings(value = {}) {
  const session = {
    ...DEFAULT_AUTOMATION_SETTINGS.session,
    ...(value.session || {}),
  };
  return {
    ...DEFAULT_AUTOMATION_SETTINGS,
    ...(value || {}),
    session: {
      ...session,
      folder: trimString(session.folder) || DEFAULT_AUTOMATION_SETTINGS.session.folder,
      tool: trimString(session.tool) || DEFAULT_AUTOMATION_SETTINGS.session.tool,
      group: trimString(session.group) || DEFAULT_AUTOMATION_SETTINGS.session.group,
      description: trimString(session.description) || DEFAULT_AUTOMATION_SETTINGS.session.description,
      thinking: session.thinking === true,
      model: trimString(session.model),
      effort: trimString(session.effort),
      systemPrompt: trimString(session.systemPrompt) || DEFAULT_AUTOMATION_SETTINGS.session.systemPrompt,
    },
    chatBaseUrl: trimString(value.chatBaseUrl) || DEFAULT_AUTOMATION_SETTINGS.chatBaseUrl,
    enabled: value.enabled !== false,
  };
}

function normalizeOutboundConfig(value = {}) {
  return {
    ...DEFAULT_OUTBOUND_CONFIG,
    ...(value || {}),
    provider: trimString(value.provider) || DEFAULT_OUTBOUND_CONFIG.provider,
    apiBaseUrl: trimString(value.apiBaseUrl) || DEFAULT_OUTBOUND_CONFIG.apiBaseUrl,
    alias: trimString(value.alias),
    from: trimString(value.from),
    apiToken: trimString(value.apiToken),
    apiTokenEnv: trimString(value.apiTokenEnv) || DEFAULT_OUTBOUND_CONFIG.apiTokenEnv,
    password: trimString(value.password),
    passwordEnv: trimString(value.passwordEnv) || DEFAULT_OUTBOUND_CONFIG.passwordEnv,
  };
}

function splitRawMessage(rawMessage) {
  const windowsDelimiterIndex = rawMessage.indexOf('\r\n\r\n');
  if (windowsDelimiterIndex !== -1) {
    return {
      headerText: rawMessage.slice(0, windowsDelimiterIndex),
      bodyText: rawMessage.slice(windowsDelimiterIndex + 4),
    };
  }

  const unixDelimiterIndex = rawMessage.indexOf('\n\n');
  if (unixDelimiterIndex !== -1) {
    return {
      headerText: rawMessage.slice(0, unixDelimiterIndex),
      bodyText: rawMessage.slice(unixDelimiterIndex + 2),
    };
  }

  return {
    headerText: rawMessage,
    bodyText: '',
  };
}

function parseHeaders(headerText) {
  const lines = headerText.split(/\r?\n/);
  const headers = {};
  let currentName = '';

  for (const line of lines) {
    if (!line) {
      continue;
    }

    if (/^[\t ]/.test(line) && currentName) {
      headers[currentName] = `${headers[currentName]} ${line.trim()}`;
      continue;
    }

    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    currentName = line.slice(0, separatorIndex).trim().toLowerCase();
    headers[currentName] = line.slice(separatorIndex + 1).trim();
  }

  return headers;
}

function extractPrimaryAddress(headerValue) {
  const match = String(headerValue || '').match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
  return normalizeEmailAddress(match ? match[0] : '');
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function decodeQuotedPrintable(text) {
  return String(text || '')
    .replace(/=\r?\n/g, '')
    .replace(/=([A-F0-9]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractMultipartBoundary(contentType) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return trimString(match?.[1] || match?.[2]);
}

function extractBestEffortBodyText(bodyText, contentType) {
  const boundary = extractMultipartBoundary(contentType);
  if (!boundary) {
    return normalizeBodyPreview(bodyText, contentType);
  }

  const parts = String(bodyText || '').split(new RegExp(`(?:\r?\n)?--${boundary}(?:--)?\r?\n`, 'g'));
  const normalizedParts = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === '--') continue;
    const { headerText, bodyText: partBody } = splitRawMessage(trimmed);
    const partHeaders = parseHeaders(headerText);
    const partContentType = trimString(partHeaders['content-type']);
    const normalized = normalizeBodyPreview(decodeQuotedPrintable(partBody), partContentType);
    if (!normalized) continue;
    normalizedParts.push({
      contentType: partContentType,
      text: normalized,
    });
  }

  const plainText = normalizedParts.find((part) => /text\/plain/i.test(part.contentType));
  if (plainText?.text) return plainText.text;
  const htmlText = normalizedParts.find((part) => /text\/html/i.test(part.contentType));
  if (htmlText?.text) return htmlText.text;
  return normalizeBodyPreview(decodeQuotedPrintable(bodyText), contentType);
}

function normalizeBodyPreview(bodyText, contentType) {
  const content = String(bodyText || '');
  const maybeHtml = /text\/html/i.test(String(contentType || '')) || /<html|<body|<div|<p|<br/i.test(content);
  const normalized = maybeHtml ? stripHtml(content) : content;
  return normalized
    .replace(/=\r?\n/g, '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\t ]+/g, ' ')
    .trim();
}

function compactHeaders(headers) {
  const keys = ['from', 'to', 'cc', 'subject', 'date', 'message-id', 'content-type'];
  return Object.fromEntries(keys.filter((key) => headers[key]).map((key) => [key, headers[key]]));
}

function buildItemId(rawMessage) {
  return `mail_${Date.now()}_${sha256(rawMessage).slice(0, 12)}_${randomUUID().slice(0, 8)}`;
}

function loadIdentity(rootDir = DEFAULT_ROOT_DIR) {
  return readJson(mailboxPaths(rootDir).identityFile, null);
}

function loadBridge(rootDir = DEFAULT_ROOT_DIR) {
  return readJson(mailboxPaths(rootDir).bridgeFile, null);
}

function loadOutboundConfig(rootDir = DEFAULT_ROOT_DIR) {
  return normalizeOutboundConfig(readJson(mailboxPaths(rootDir).outboundFile, DEFAULT_OUTBOUND_CONFIG));
}

function saveOutboundConfig(rootDir = DEFAULT_ROOT_DIR, outboundConfig = {}) {
  const normalized = normalizeOutboundConfig(outboundConfig);
  writeJson(mailboxPaths(rootDir).outboundFile, normalized);
  return normalized;
}

function loadMailboxAutomation(rootDir = DEFAULT_ROOT_DIR) {
  return mergeAutomationSettings(readJson(mailboxPaths(rootDir).automationFile, DEFAULT_AUTOMATION_SETTINGS));
}

function saveMailboxAutomation(rootDir = DEFAULT_ROOT_DIR, automationSettings = {}) {
  const normalized = mergeAutomationSettings(automationSettings);
  writeJson(mailboxPaths(rootDir).automationFile, normalized);
  return normalized;
}

function loadAllowlist(rootDir = DEFAULT_ROOT_DIR) {
  const allowlist = readJson(mailboxPaths(rootDir).allowlistFile, {
    allowedEmails: [],
    allowedDomains: [],
    updatedAt: null,
  });

  return {
    allowedEmails: dedupeSorted((allowlist.allowedEmails || []).map(normalizeEmailAddress)),
    allowedDomains: dedupeSorted((allowlist.allowedDomains || []).map(normalizeDomain)),
    updatedAt: allowlist.updatedAt || null,
  };
}

function saveAllowlist(rootDir, allowlist) {
  const normalizedAllowlist = {
    allowedEmails: dedupeSorted((allowlist.allowedEmails || []).map(normalizeEmailAddress)),
    allowedDomains: dedupeSorted((allowlist.allowedDomains || []).map(normalizeDomain)),
    updatedAt: nowIso(),
  };
  writeJson(mailboxPaths(rootDir).allowlistFile, normalizedAllowlist);
  return normalizedAllowlist;
}

function matchAllowlist(senderAddress, allowlist) {
  if (!senderAddress) {
    return {
      allowed: false,
      ruleType: 'none',
      ruleValue: '',
    };
  }

  const senderDomain = senderAddress.split('@')[1] || '';
  if (allowlist.allowedEmails.includes(senderAddress)) {
    return {
      allowed: true,
      ruleType: 'email',
      ruleValue: senderAddress,
    };
  }

  if (allowlist.allowedDomains.includes(senderDomain)) {
    return {
      allowed: true,
      ruleType: 'domain',
      ruleValue: senderDomain,
    };
  }

  return {
    allowed: false,
    ruleType: 'none',
    ruleValue: '',
  };
}

function queuePathFromName(paths, queueName) {
  if (queueName === REVIEW_QUEUE) return paths.reviewDir;
  if (queueName === QUARANTINE_QUEUE) return paths.quarantineDir;
  if (queueName === APPROVED_QUEUE) return paths.approvedDir;
  throw new Error(`Unknown queue: ${queueName}`);
}

function normalizeMessage({ rawMessage, sourcePath, identity, allowlist, extractedText = '', extractedHtml = '' }) {
  const { headerText, bodyText } = splitRawMessage(rawMessage);
  const headers = parseHeaders(headerText);
  const senderAddress = extractPrimaryAddress(headers.from);
  const recipientAddress = extractPrimaryAddress(headers.to);
  const allowMatch = matchAllowlist(senderAddress, allowlist);
  const queueName = allowMatch.allowed ? REVIEW_QUEUE : QUARANTINE_QUEUE;
  const messageText = trimString(extractedText)
    || extractBestEffortBodyText(bodyText, headers['content-type']);
  const previewText = messageText || normalizeBodyPreview(trimString(extractedHtml), 'text/html');
  const itemId = buildItemId(rawMessage);
  const createdAt = nowIso();

  return {
    id: itemId,
    queue: queueName,
    status: allowMatch.allowed ? 'pending_manual_review' : 'quarantined_sender_not_allowlisted',
    createdAt,
    updatedAt: createdAt,
    identity: identity ? {
      name: identity.name,
      address: identity.address,
    } : null,
    source: {
      type: 'file',
      originalPath: sourcePath,
      fileName: basename(sourcePath),
    },
    message: {
      from: headers.from || '',
      fromAddress: senderAddress,
      to: headers.to || '',
      toAddress: recipientAddress,
      subject: headers.subject || '',
      date: headers.date || '',
      messageId: headers['message-id'] || '',
      headers: compactHeaders(headers),
    },
    security: {
      senderAllowed: allowMatch.allowed,
      matchedRule: allowMatch.ruleType,
      matchedValue: allowMatch.ruleValue,
      aiEligible: false,
      manualReviewRequired: true,
      reasoning: allowMatch.allowed
        ? 'Sender matched the allowlist, but the message still waits for manual review before any AI processing.'
        : 'Sender did not match the allowlist and has been quarantined before AI processing.',
    },
    review: {
      status: allowMatch.allowed ? 'pending' : 'blocked',
      approvedAt: null,
      reviewer: null,
    },
    content: {
      preview: previewText.slice(0, 1200),
      extractedText: messageText,
      rawBytes: Buffer.byteLength(rawMessage),
      bodyBytes: Buffer.byteLength(bodyText),
      rawSha256: sha256(rawMessage),
      bodySha256: sha256(bodyText),
    },
    storage: {
      rawPath: '',
    },
  };
}

function ingestRawMessage(rawMessage, sourcePath, rootDir = DEFAULT_ROOT_DIR, metadata = {}) {
  const paths = ensureMailboxRoot(rootDir);
  const identity = loadIdentity(rootDir);
  if (!identity) {
    throw new Error(`Mailbox identity not initialized. Run init first: ${paths.identityFile}`);
  }

  const allowlist = loadAllowlist(rootDir);
  const normalizedItem = normalizeMessage({
    rawMessage,
    sourcePath,
    identity,
    allowlist,
    extractedText: metadata.text,
    extractedHtml: metadata.html,
  });
  const rawTargetPath = join(paths.rawDir, `${normalizedItem.id}.eml`);
  const jsonTargetPath = join(queuePathFromName(paths, normalizedItem.queue), `${normalizedItem.id}.json`);

  writeFileSync(rawTargetPath, rawMessage, 'utf8');
  normalizedItem.storage.rawPath = rawTargetPath;
  writeJson(jsonTargetPath, normalizedItem);
  appendJsonl(paths.eventsFile, {
    event: 'ingested',
    id: normalizedItem.id,
    queue: normalizedItem.queue,
    createdAt: normalizedItem.createdAt,
    sender: normalizedItem.message.fromAddress,
    subject: normalizedItem.message.subject,
    sourcePath,
  });

  return normalizedItem;
}

function ingestFile(sourcePath, rootDir = DEFAULT_ROOT_DIR) {
  return ingestRawMessage(readFileSync(sourcePath, 'utf8'), sourcePath, rootDir);
}

function ingestSource(sourcePath, rootDir = DEFAULT_ROOT_DIR) {
  const sourceStats = statSync(sourcePath);
  if (sourceStats.isDirectory()) {
    const filePaths = readdirSync(sourcePath)
      .map((fileName) => join(sourcePath, fileName))
      .filter((filePath) => statSync(filePath).isFile())
      .sort((left, right) => left.localeCompare(right));

    return filePaths.map((filePath) => ingestFile(filePath, rootDir));
  }

  return [ingestFile(sourcePath, rootDir)];
}

function listQueue(queueName = REVIEW_QUEUE, rootDir = DEFAULT_ROOT_DIR) {
  const paths = ensureMailboxRoot(rootDir);
  const directoryPath = queuePathFromName(paths, queueName);
  return readdirSync(directoryPath)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => readJson(join(directoryPath, fileName), null))
    .filter(Boolean)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

function queueCounts(rootDir = DEFAULT_ROOT_DIR) {
  return Object.fromEntries(KNOWN_QUEUES.map((queueName) => [queueName, listQueue(queueName, rootDir).length]));
}

function findQueueItem(id, rootDir = DEFAULT_ROOT_DIR) {
  const paths = ensureMailboxRoot(rootDir);
  for (const queueName of KNOWN_QUEUES) {
    const filePath = join(queuePathFromName(paths, queueName), `${id}.json`);
    if (!existsSync(filePath)) continue;
    const item = readJson(filePath, null);
    if (!item) continue;
    return { item, queueName, filePath };
  }
  return null;
}

function updateQueueItem(id, rootDir = DEFAULT_ROOT_DIR, updater = (item) => item) {
  const located = findQueueItem(id, rootDir);
  if (!located) {
    throw new Error(`Queue item not found: ${id}`);
  }

  const draft = deepClone(located.item);
  const updated = updater(draft, located.item);
  const nextItem = updated && typeof updated === 'object' ? updated : draft;
  nextItem.updatedAt = nowIso();
  writeJson(located.filePath, nextItem);
  return nextItem;
}

function assessMailboxPublicIngress(identity, bridge) {
  const diagnostics = [];
  const assessment = {
    diagnostics,
    effectiveStatus: identity?.status || null,
    publicIngress: bridge ? 'bridge_configured' : 'not_configured',
  };

  if (!bridge) {
    return assessment;
  }

  const provider = String(bridge.provider || '').trim().toLowerCase();
  if (provider !== 'forwardemail') {
    if (bridge.validation?.publicHealth === 'pass') {
      assessment.effectiveStatus = 'public_webhook_healthy';
      assessment.publicIngress = 'public_webhook_healthy';
    }
    return assessment;
  }

  const assumedPlan = String(bridge.plan || bridge.protectionTier || 'free').trim().toLowerCase();
  const domain = normalizeDomain(identity?.domain || String(bridge.emailAddress || '').split('@')[1] || '');
  const tld = topLevelDomain(domain);

  if (tld && !FORWARD_EMAIL_FREE_TLDS.has(tld) && !['enhanced_protection', 'private-business-email', 'paid'].includes(assumedPlan)) {
    diagnostics.push({
      severity: 'error',
      code: 'forwardemail_enhanced_protection_required',
      provider: 'forwardemail',
      domain,
      tld,
      assumedPlan,
      message: `Forward Email's free tier does not accept recipient domains on .${tld}. Inbound mail to ${identity?.address || bridge.emailAddress || domain} will bounce until Enhanced Protection is enabled or the mailbox moves to a supported TLD.`,
      reference: 'https://forwardemail.net/faq#what-domain-name-extensions-can-be-used-for-free',
    });
    assessment.effectiveStatus = 'public_ingress_blocked_provider_plan';
    assessment.publicIngress = 'blocked_provider_plan';
    return assessment;
  }

  if (bridge.validation?.realExternalMailValidated) {
    assessment.effectiveStatus = 'external_mail_validated';
    assessment.publicIngress = 'external_mail_validated';
    return assessment;
  }

  if (bridge.validation?.queueReadyForRealMail) {
    assessment.effectiveStatus = 'ready_for_external_mail';
    assessment.publicIngress = 'ready_for_external_mail';
    return assessment;
  }

  if (bridge.validation?.publicHealth === 'pass') {
    assessment.effectiveStatus = 'public_webhook_healthy';
    assessment.publicIngress = 'public_webhook_healthy';
    return assessment;
  }

  assessment.publicIngress = 'provider_compatible_pending_validation';
  return assessment;
}

function getMailboxStatus(rootDir = DEFAULT_ROOT_DIR) {
  const identity = loadIdentity(rootDir);
  const allowlist = loadAllowlist(rootDir);
  const bridge = loadBridge(rootDir);
  const outbound = loadOutboundConfig(rootDir);
  const automation = loadMailboxAutomation(rootDir);
  const reviewItems = listQueue(REVIEW_QUEUE, rootDir);
  const quarantineItems = listQueue(QUARANTINE_QUEUE, rootDir);
  const approvedItems = listQueue(APPROVED_QUEUE, rootDir);
  const ingress = assessMailboxPublicIngress(identity, bridge);

  return {
    rootDir,
    identity,
    allowlist,
    bridge,
    outbound: summarizeOutboundConfig(outbound),
    automation,
    counts: queueCounts(rootDir),
    latest: {
      review: reviewItems[0] ? summarizeQueueItem(reviewItems[0]) : null,
      quarantine: quarantineItems[0] ? summarizeQueueItem(quarantineItems[0]) : null,
      approved: approvedItems[0] ? summarizeQueueItem(approvedItems[0]) : null,
    },
    effectiveStatus: ingress.effectiveStatus,
    publicIngress: ingress.publicIngress,
    diagnostics: ingress.diagnostics,
  };
}

function initializeMailbox({ rootDir = DEFAULT_ROOT_DIR, name, localPart, domain, description, allowEmails = [], allowDomains = [] }) {
  if (!name || !localPart || !domain) {
    throw new Error('init requires --name, --local-part, and --domain');
  }

  const paths = ensureMailboxRoot(rootDir);
  const createdAt = nowIso();
  const normalizedLocalPart = String(localPart).trim().toLowerCase();
  const normalizedDomain = String(domain).trim().toLowerCase();
  const identity = {
    name: String(name).trim(),
    localPart: normalizedLocalPart,
    domain: normalizedDomain,
    address: `${normalizedLocalPart}@${normalizedDomain}`,
    description: description || 'Agent-facing mailbox identity for RemoteLab collaboration.',
    createdAt,
    updatedAt: createdAt,
    status: 'local_intake_ready_public_dns_pending',
  };

  const allowlist = saveAllowlist(rootDir, {
    allowedEmails: allowEmails,
    allowedDomains: allowDomains,
  });

  writeJson(paths.identityFile, identity);
  appendJsonl(paths.eventsFile, {
    event: 'initialized',
    createdAt,
    identity: {
      name: identity.name,
      address: identity.address,
    },
    allowlist,
  });

  return {
    rootDir,
    identity,
    allowlist,
  };
}

function addAllowEntry(entry, rootDir = DEFAULT_ROOT_DIR) {
  const currentAllowlist = loadAllowlist(rootDir);
  if (String(entry).includes('@')) {
    currentAllowlist.allowedEmails.push(normalizeEmailAddress(entry));
  } else {
    currentAllowlist.allowedDomains.push(normalizeDomain(entry));
  }

  const savedAllowlist = saveAllowlist(rootDir, currentAllowlist);
  appendJsonl(mailboxPaths(rootDir).eventsFile, {
    event: 'allowlist_updated',
    createdAt: nowIso(),
    entry,
    allowlist: savedAllowlist,
  });
  return savedAllowlist;
}

function approveMessage(id, rootDir = DEFAULT_ROOT_DIR, reviewer = 'manual-operator') {
  const paths = ensureMailboxRoot(rootDir);
  const reviewPath = join(paths.reviewDir, `${id}.json`);
  if (!existsSync(reviewPath)) {
    throw new Error(`Review item not found: ${id}`);
  }

  const item = readJson(reviewPath, null);
  if (!item) {
    throw new Error(`Could not read review item: ${id}`);
  }

  const approvedPath = join(paths.approvedDir, `${id}.json`);
  renameSync(reviewPath, approvedPath);
  item.queue = APPROVED_QUEUE;
  item.status = 'approved_for_ai';
  item.updatedAt = nowIso();
  item.security.aiEligible = true;
  item.review.status = 'approved';
  item.review.approvedAt = item.updatedAt;
  item.review.reviewer = reviewer;
  writeJson(approvedPath, item);
  appendJsonl(paths.eventsFile, {
    event: 'approved',
    id,
    createdAt: item.updatedAt,
    reviewer,
    sender: item.message.fromAddress,
    subject: item.message.subject,
  });
  return item;
}

function summarizeQueueItem(item) {
  return {
    id: item.id,
    queue: item.queue,
    status: item.status,
    from: item.message.fromAddress,
    subject: item.message.subject,
    createdAt: item.createdAt,
  };
}

export {
  APPROVED_QUEUE,
  DEFAULT_ROOT_DIR,
  DEFAULT_AUTOMATION_SETTINGS,
  DEFAULT_OUTBOUND_CONFIG,
  FORWARD_EMAIL_FREE_TLDS,
  KNOWN_QUEUES,
  QUARANTINE_QUEUE,
  REVIEW_QUEUE,
  addAllowEntry,
  assessMailboxPublicIngress,
  approveMessage,
  ensureMailboxRoot,
  findQueueItem,
  getMailboxStatus,
  initializeMailbox,
  ingestRawMessage,
  ingestSource,
  listQueue,
  loadAllowlist,
  loadMailboxAutomation,
  loadBridge,
  loadIdentity,
  loadOutboundConfig,
  mailboxPaths,
  queueCounts,
  saveMailboxAutomation,
  saveOutboundConfig,
  summarizeQueueItem,
  topLevelDomain,
  updateQueueItem,
};
