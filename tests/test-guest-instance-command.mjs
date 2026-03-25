#!/usr/bin/env node
import assert from 'assert/strict';

import {
  buildGuestMailboxAddress,
  formatGuestInstance,
} from '../lib/guest-instance-command.mjs';
import {
  buildLaunchAgentPlist,
  deriveDomainFromHostname,
  deriveGuestHostname,
  parseTunnelName,
  pickNextGuestPort,
  sanitizeGuestInstanceName,
  selectPrimaryHostnameForPort,
  upsertCloudflaredIngress,
} from '../lib/guest-instance.mjs';

const baseConfig = `tunnel: claude-code-remote
credentials-file: /Users/example/.cloudflared/example-tunnel.json
protocol: http2

ingress:
  - hostname: remotelab.example.com
    service: http://127.0.0.1:7690
  - hostname: companion.example.com
    service: http://127.0.0.1:7692
  - service: http_status:404
`;

assert.equal(sanitizeGuestInstanceName(' Trial 4 '), 'trial-4');
assert.equal(sanitizeGuestInstanceName('试用 用户'), '');
assert.equal(
  buildGuestMailboxAddress('trial16', { localPart: 'rowan', domain: 'jiujianian.dev' }),
  'rowan+trial16@jiujianian.dev',
);
assert.equal(
  buildGuestMailboxAddress('trial16', { localPart: 'rowan', domain: 'jiujianian.dev', instanceAddressMode: 'local_part' }),
  'trial16@jiujianian.dev',
);
assert.equal(
  buildGuestMailboxAddress(' Trial 16 ', { localPart: 'rowan', domain: 'jiujianian.dev' }),
  'rowan+trial-16@jiujianian.dev',
);
assert.equal(
  buildGuestMailboxAddress(' Trial 16 ', { localPart: 'rowan', domain: 'jiujianian.dev', instanceAddressMode: 'local_part' }),
  'trial-16@jiujianian.dev',
);
assert.equal(buildGuestMailboxAddress('试用 用户', { localPart: 'rowan', domain: 'jiujianian.dev' }), '');

assert.equal(parseTunnelName(baseConfig), 'claude-code-remote');
assert.equal(selectPrimaryHostnameForPort(baseConfig, { port: 7690 }), 'remotelab.example.com');
assert.equal(deriveDomainFromHostname('remotelab.example.com'), 'example.com');
assert.equal(
  deriveGuestHostname(baseConfig, { name: 'trial4' }),
  'trial4.example.com',
);

assert.equal(
  pickNextGuestPort([7696, 7697, 7699], { startPort: 7696 }),
  7698,
);

const addedIngress = upsertCloudflaredIngress(baseConfig, {
  hostname: 'trial4.example.com',
  service: 'http://127.0.0.1:7699',
});
assert.match(
  addedIngress,
  /hostname: trial4\.example\.com\n\s+service: http:\/\/127\.0\.0\.1:7699\n\s+- service: http_status:404/,
  'should insert the new ingress entry before the fallback rule',
);

const updatedIngress = upsertCloudflaredIngress(baseConfig, {
  hostname: 'companion.example.com',
  service: 'http://127.0.0.1:7800',
});
assert.match(
  updatedIngress,
  /hostname: companion\.example\.com\n\s+service: http:\/\/127\.0\.0\.1:7800/,
  'should update an existing hostname entry in place',
);

const newConfig = upsertCloudflaredIngress('', {
  hostname: 'trial5.example.com',
  service: 'http://127.0.0.1:7700',
});
assert.match(newConfig, /^ingress:\n  - hostname: trial5\.example\.com/m, 'should create a new ingress section when absent');

const plist = buildLaunchAgentPlist({
  label: 'com.chatserver.trial4',
  nodePath: '/usr/local/bin/node',
  chatServerPath: '/Users/example/code/remotelab/chat-server.mjs',
  workingDirectory: '/Users/example/code/remotelab',
  standardOutPath: '/Users/example/Library/Logs/chat-server-trial4.log',
  standardErrorPath: '/Users/example/Library/Logs/chat-server-trial4.error.log',
  environmentVariables: {
    CHAT_PORT: '7699',
    REMOTELAB_INSTANCE_ROOT: '/Users/example/.remotelab/instances/trial4',
  },
});
assert.match(plist, /<string>com\.chatserver\.trial4<\/string>/);
assert.match(plist, /<key>CHAT_PORT<\/key><string>7699<\/string>/);
assert.match(plist, /<string>\/Users\/example\/code\/remotelab\/chat-server\.mjs<\/string>/);

const formatted = formatGuestInstance({
  name: 'trial16',
  port: 7710,
  localBaseUrl: 'http://127.0.0.1:7710',
  publicBaseUrl: 'https://trial16.example.com',
  mailboxAddress: 'rowan+trial16@jiujianian.dev',
  instanceRoot: '/Users/example/.remotelab/instances/trial16',
  configDir: '/Users/example/.remotelab/instances/trial16/config',
  memoryDir: '/Users/example/.remotelab/instances/trial16/memory',
  launchAgentPath: '/Users/example/Library/LaunchAgents/com.chatserver.trial16.plist',
  createdAt: '2026-03-24T00:00:00.000Z',
}, {
  localReachable: true,
});
assert.match(formatted, /mailbox: rowan\+trial16@jiujianian\.dev/);

console.log('test-guest-instance-command: ok');
