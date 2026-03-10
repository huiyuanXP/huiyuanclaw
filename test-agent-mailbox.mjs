#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { getMailboxStatus, initializeMailbox, mailboxPaths } from './lib/agent-mailbox.mjs';

function testForwardEmailUnsupportedTld() {
  const rootDir = mkdtempSync(join(tmpdir(), 'remotelab-agent-mailbox-unsupported-'));
  try {
    initializeMailbox({
      rootDir,
      name: 'Rowan',
      localPart: 'rowan',
      domain: 'jiujianian-dev-world.win',
      allowEmails: ['jiujianian@gmail.com'],
    });
    writeFileSync(
      mailboxPaths(rootDir).bridgeFile,
      `${JSON.stringify({
        provider: 'forwardemail',
        emailAddress: 'rowan@jiujianian-dev-world.win',
        validation: {
          publicHealth: 'pass',
          queueReadyForRealMail: true,
        },
      }, null, 2)}\n`,
      'utf8',
    );

    const status = getMailboxStatus(rootDir);
    assert.equal(status.effectiveStatus, 'public_ingress_blocked_provider_plan');
    assert.equal(status.publicIngress, 'blocked_provider_plan');
    assert.equal(status.diagnostics.length, 1);
    assert.equal(status.diagnostics[0].code, 'forwardemail_enhanced_protection_required');
    assert.match(status.diagnostics[0].message, /will bounce/i);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

function testForwardEmailSupportedTld() {
  const rootDir = mkdtempSync(join(tmpdir(), 'remotelab-agent-mailbox-supported-'));
  try {
    initializeMailbox({
      rootDir,
      name: 'Rowan',
      localPart: 'rowan',
      domain: 'jiujianian-dev-world.dev',
      allowEmails: ['jiujianian@gmail.com'],
    });
    writeFileSync(
      mailboxPaths(rootDir).bridgeFile,
      `${JSON.stringify({
        provider: 'forwardemail',
        emailAddress: 'rowan@jiujianian-dev-world.dev',
        validation: {
          publicHealth: 'pass',
          queueReadyForRealMail: true,
        },
      }, null, 2)}\n`,
      'utf8',
    );

    const status = getMailboxStatus(rootDir);
    assert.equal(status.effectiveStatus, 'ready_for_external_mail');
    assert.equal(status.publicIngress, 'ready_for_external_mail');
    assert.equal(status.diagnostics.length, 0);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

function testForwardEmailValidatedDelivery() {
  const rootDir = mkdtempSync(join(tmpdir(), 'remotelab-agent-mailbox-validated-'));
  try {
    initializeMailbox({
      rootDir,
      name: 'Rowan',
      localPart: 'rowan',
      domain: 'jiujianian.dev',
      allowEmails: ['jiujianian@gmail.com'],
    });
    writeFileSync(
      mailboxPaths(rootDir).bridgeFile,
      `${JSON.stringify({
        provider: 'forwardemail',
        emailAddress: 'rowan@jiujianian.dev',
        validation: {
          publicHealth: 'pass',
          queueReadyForRealMail: true,
          realExternalMailValidated: true,
        },
      }, null, 2)}\n`,
      'utf8',
    );

    const status = getMailboxStatus(rootDir);
    assert.equal(status.effectiveStatus, 'external_mail_validated');
    assert.equal(status.publicIngress, 'external_mail_validated');
    assert.equal(status.diagnostics.length, 0);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

testForwardEmailUnsupportedTld();
testForwardEmailSupportedTld();
testForwardEmailValidatedDelivery();
console.log('agent mailbox tests passed');
