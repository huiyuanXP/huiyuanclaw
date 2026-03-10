const DEFAULT_FORWARD_EMAIL_API_BASE_URL = 'https://api.forwardemail.net/v1';

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value) {
  const trimmed = trimString(value);
  if (!trimmed) return DEFAULT_FORWARD_EMAIL_API_BASE_URL;
  return trimmed.replace(/\/+$/, '');
}

function resolveSecret(config, directKey, envKey) {
  const directValue = trimString(config?.[directKey]);
  if (directValue) return directValue;
  const envName = trimString(config?.[envKey]);
  if (!envName) return '';
  return trimString(process.env[envName]);
}

function configuredAuthMode(config = {}) {
  if (resolveSecret(config, 'apiToken', 'apiTokenEnv')) {
    return 'api_token';
  }
  if (trimString(config.alias) && resolveSecret(config, 'password', 'passwordEnv')) {
    return 'alias_password';
  }
  return 'unconfigured';
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = trimString(value);
    if (trimmed) return trimmed;
  }
  return '';
}

function normalizeRecipients(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => trimString(entry)).filter(Boolean);
  }
  const single = trimString(value);
  return single ? [single] : [];
}

function buildBasicAuthHeader(username, password = '') {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function parseJsonMaybe(text) {
  if (!trimString(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function responseMessage(body, fallbackText) {
  if (!body || typeof body !== 'object') return trimString(fallbackText);
  return firstNonEmpty(body.message, body.error, body.detail, fallbackText);
}

function summarizedResponse(body) {
  if (!body || typeof body !== 'object') return null;
  return {
    id: firstNonEmpty(body.id, body.messageId, body.message_id),
    message: firstNonEmpty(body.message, body.status),
  };
}

function prepareForwardEmailConfig(config = {}, message = {}) {
  const authMode = configuredAuthMode(config);
  const alias = firstNonEmpty(config.alias, message.from);
  const from = firstNonEmpty(message.from, config.from, alias);
  const to = normalizeRecipients(message.to);
  const subject = trimString(message.subject);
  const text = typeof message.text === 'string' ? message.text.trim() : '';

  if (to.length === 0) {
    throw new Error('Outbound email requires at least one recipient');
  }
  if (!subject) {
    throw new Error('Outbound email requires a subject');
  }
  if (!text) {
    throw new Error('Outbound email requires a text body');
  }
  if (authMode === 'unconfigured') {
    throw new Error('Outbound email is not configured. Set an API token or alias password first.');
  }

  const apiToken = resolveSecret(config, 'apiToken', 'apiTokenEnv');
  const password = resolveSecret(config, 'password', 'passwordEnv');
  const username = authMode === 'api_token' ? apiToken : alias;
  const authPassword = authMode === 'api_token' ? '' : password;

  if (!username) {
    throw new Error('Outbound email authentication is missing a username');
  }
  if (!from) {
    throw new Error('Outbound email requires a sender address');
  }

  return {
    provider: 'forwardemail_api',
    authMode,
    apiBaseUrl: normalizeBaseUrl(config.apiBaseUrl),
    username,
    authPassword,
    from,
    to,
    subject,
    text,
  };
}

export function summarizeOutboundConfig(config = {}) {
  const provider = firstNonEmpty(config.provider, 'forwardemail_api');
  return {
    provider,
    apiBaseUrl: normalizeBaseUrl(config.apiBaseUrl),
    alias: trimString(config.alias),
    from: trimString(config.from),
    apiTokenEnv: trimString(config.apiTokenEnv),
    passwordEnv: trimString(config.passwordEnv),
    authMode: configuredAuthMode(config),
    configured: configuredAuthMode(config) !== 'unconfigured',
  };
}

export async function sendOutboundEmail(message, config = {}, options = {}) {
  const provider = firstNonEmpty(config.provider, 'forwardemail_api').toLowerCase();
  if (provider !== 'forwardemail_api') {
    throw new Error(`Unsupported outbound email provider: ${provider}`);
  }

  const prepared = prepareForwardEmailConfig(config, message);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is unavailable in this Node runtime');
  }

  const body = new URLSearchParams();
  body.set('to', prepared.to.join(','));
  body.set('subject', prepared.subject);
  body.set('text', prepared.text);
  body.set('from', prepared.from);

  const response = await fetchImpl(`${prepared.apiBaseUrl}/emails`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: buildBasicAuthHeader(prepared.username, prepared.authPassword),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const rawText = await response.text();
  const parsedBody = parseJsonMaybe(rawText);
  if (!response.ok) {
    throw new Error(`Outbound email failed (${response.status}): ${responseMessage(parsedBody, rawText) || 'Unknown error'}`);
  }

  return {
    provider: prepared.provider,
    authMode: prepared.authMode,
    statusCode: response.status,
    response: parsedBody || rawText,
    summary: summarizedResponse(parsedBody),
  };
}
