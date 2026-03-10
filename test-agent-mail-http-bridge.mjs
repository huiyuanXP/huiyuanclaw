#!/usr/bin/env node
import assert from 'assert/strict';

import { assessForwardEmailSource } from './lib/agent-mail-http-bridge.mjs';

async function testTrustsKnownForwardEmailPtrHost() {
  const assessment = await assessForwardEmailSource('121.127.44.59', {
    reverseLookup: async () => ['mx2.forwardemail.net'],
    resolverLookup: async () => [{ address: '198.18.14.120' }],
  });

  assert.equal(assessment.trusted, true);
  assert.equal(assessment.reason, 'reverse_ptr_match');
  assert.equal(assessment.matchedHostname, 'mx2.forwardemail.net');
}

async function testFallsBackToResolvedHostnameMatch() {
  const assessment = await assessForwardEmailSource('198.18.14.120', {
    reverseLookup: async () => {
      throw new Error('reverse unavailable');
    },
    resolverLookup: async (hostname) => (hostname === 'mx2.forwardemail.net' ? [{ address: '198.18.14.120' }] : []),
  });

  assert.equal(assessment.trusted, true);
  assert.equal(assessment.reason, 'resolved_hostname_match');
  assert.equal(assessment.matchedHostname, 'mx2.forwardemail.net');
}

async function testRejectsUnknownPtrHost() {
  const assessment = await assessForwardEmailSource('103.137.247.47', {
    reverseLookup: async () => ['103-137-247-47.dynamic-ip.pni.tw'],
    resolverLookup: async () => [{ address: '198.18.14.120' }],
  });

  assert.equal(assessment.trusted, false);
  assert.equal(assessment.reason, 'hostname_not_trusted');
  assert.deepEqual(assessment.hostnames, ['103-137-247-47.dynamic-ip.pni.tw']);
}

await testTrustsKnownForwardEmailPtrHost();
await testFallsBackToResolvedHostnameMatch();
await testRejectsUnknownPtrHost();
console.log('agent mail http bridge tests passed');
