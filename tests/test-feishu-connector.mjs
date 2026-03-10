#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

const repoRoot = process.cwd();

const {
  ensureAllowedSendersFile,
  handleMessage,
  isAllowedByPolicy,
  normalizeReplyText,
} = await import(pathToFileURL(join(repoRoot, 'scripts', 'feishu-connector.mjs')).href);

const runtime = {
  processingMessageIds: new Set(),
  storagePaths: {
    handledMessagesPath: '/tmp/remotelab-feishu-connector-test-handled.json',
  },
};

const summary = {
  messageId: 'msg_test_1',
  chatId: 'chat_test_1',
  messageType: 'text',
  sender: {
    senderType: 'user',
  },
};

let sendCalls = 0;
const handled = [];

await handleMessage(runtime, summary, 'test', {
  wasMessageHandled: async () => false,
  generateRemoteLabReply: async () => ({
    sessionId: 'session_test_1',
    runId: 'run_test_1',
    requestId: 'request_test_1',
    duplicate: false,
    replyText: '',
  }),
  sendFeishuText: async () => {
    sendCalls += 1;
    return { message_id: 'out_test_1' };
  },
  markMessageHandled: async (_pathname, messageId, metadata) => {
    handled.push({ messageId, metadata });
  },
});

assert.equal(sendCalls, 0, 'empty assistant replies should not be sent to Feishu');
assert.equal(handled.length, 1, 'empty assistant replies should still be marked handled');
assert.equal(handled[0].messageId, summary.messageId);
assert.equal(handled[0].metadata.status, 'silent_no_reply');
assert.equal(handled[0].metadata.reason, 'empty_assistant_reply');
assert.equal(handled[0].metadata.sessionId, 'session_test_1');
assert.equal(runtime.processingMessageIds.size, 0, 'message processing state should always be cleaned up');

assert.equal(normalizeReplyText('  \n\n  '), '');
assert.equal(normalizeReplyText('  hello\r\n'), 'hello');

const tempDir = await mkdtemp(join(tmpdir(), 'remotelab-feishu-whitelist-'));
const whitelistPath = join(tempDir, 'allowed-senders.json');
const whitelistPolicy = {
  mode: 'whitelist',
  allowedSendersPath: whitelistPath,
  allowedSenders: {
    openIds: ['ou_bootstrap_only'],
    userIds: [],
    unionIds: [],
    tenantKeys: [],
  },
};

await ensureAllowedSendersFile(whitelistPath, whitelistPolicy.allowedSenders);

await writeFile(whitelistPath, `${JSON.stringify({
  openIds: ['ou_dynamic_first'],
  userIds: [],
  unionIds: [],
  tenantKeys: [],
}, null, 2)}\n`, 'utf8');

assert.equal(await isAllowedByPolicy(whitelistPolicy, {
  tenantKey: 'tenant_test_1',
  sender: { openId: 'ou_dynamic_first' },
}), true, 'whitelist file should allow the current openId');

assert.equal(await isAllowedByPolicy(whitelistPolicy, {
  tenantKey: 'tenant_test_1',
  sender: { openId: 'ou_bootstrap_only' },
}), false, 'once the whitelist file exists, it should be the live source of truth');

assert.equal(await isAllowedByPolicy(whitelistPolicy, {
  tenantKey: 'tenant_test_1',
  sender: { openId: 'ou_dynamic_second' },
}), false, 'unknown openIds should still be blocked');

await writeFile(whitelistPath, `${JSON.stringify({
  openIds: ['ou_dynamic_second'],
  userIds: [],
  unionIds: [],
  tenantKeys: [],
}, null, 2)}\n`, 'utf8');

assert.equal(await isAllowedByPolicy(whitelistPolicy, {
  tenantKey: 'tenant_test_1',
  sender: { openId: 'ou_dynamic_first' },
}), false, 'policy checks should re-read the whitelist file without restart');

assert.equal(await isAllowedByPolicy(whitelistPolicy, {
  tenantKey: 'tenant_test_1',
  sender: { openId: 'ou_dynamic_second' },
}), true, 'newly written whitelist entries should take effect immediately');

console.log('ok - empty assistant replies stay silent');
console.log('ok - whitelist file reloads without restart');
