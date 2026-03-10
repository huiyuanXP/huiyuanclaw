import { reverse, lookup } from 'dns/promises';

const TRUSTED_FORWARD_EMAIL_HOSTNAMES = new Set([
  'mx1.forwardemail.net',
  'mx2.forwardemail.net',
  'smtp.forwardemail.net',
]);

function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '');
}

export function normalizeIp(value) {
  const text = String(value || '').trim();
  return text.startsWith('::ffff:') ? text.slice('::ffff:'.length) : text;
}

export function isLoopbackIp(ip) {
  return ip === '127.0.0.1' || ip === '::1';
}

async function withTimeout(promise, timeoutMs) {
  return await Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

async function matchesTrustedForwardEmailAddress(ip, { resolverLookup = lookup } = {}) {
  const normalizedIp = normalizeIp(ip);
  for (const hostname of TRUSTED_FORWARD_EMAIL_HOSTNAMES) {
    try {
      const resolved = await withTimeout(resolverLookup(hostname, { all: true }), 3000);
      if (resolved.some((entry) => normalizeIp(entry.address) === normalizedIp)) {
        return hostname;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function assessForwardEmailSource(
  ip,
  {
    reverseLookup = reverse,
    resolverLookup = lookup,
  } = {},
) {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) {
    return {
      trusted: false,
      reason: 'missing_ip',
      ip: normalizedIp,
      hostnames: [],
      matchedHostname: null,
    };
  }

  if (isLoopbackIp(normalizedIp)) {
    return {
      trusted: true,
      reason: 'loopback',
      ip: normalizedIp,
      hostnames: [],
      matchedHostname: 'loopback',
    };
  }

  let hostnames = [];
  try {
    hostnames = await withTimeout(reverseLookup(normalizedIp), 3000);
  } catch {
    hostnames = [];
  }

  const normalizedHostnames = [...new Set(hostnames.map(normalizeHostname).filter(Boolean))];
  const matchedPtrHostname = normalizedHostnames.find((hostname) => TRUSTED_FORWARD_EMAIL_HOSTNAMES.has(hostname));
  if (matchedPtrHostname) {
    return {
      trusted: true,
      reason: 'reverse_ptr_match',
      ip: normalizedIp,
      hostnames: normalizedHostnames,
      matchedHostname: matchedPtrHostname,
    };
  }

  const matchedResolvedHostname = await matchesTrustedForwardEmailAddress(normalizedIp, { resolverLookup });
  if (matchedResolvedHostname) {
    return {
      trusted: true,
      reason: 'resolved_hostname_match',
      ip: normalizedIp,
      hostnames: normalizedHostnames,
      matchedHostname: matchedResolvedHostname,
    };
  }

  return {
    trusted: false,
    reason: normalizedHostnames.length > 0 ? 'hostname_not_trusted' : 'reverse_lookup_unavailable',
    ip: normalizedIp,
    hostnames: normalizedHostnames,
    matchedHostname: null,
  };
}

export async function isTrustedForwardEmailSource(ip, options) {
  const assessment = await assessForwardEmailSource(ip, options);
  return assessment.trusted;
}

