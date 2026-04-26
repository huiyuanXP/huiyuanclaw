#!/usr/bin/env node
/**
 * Channel Bridge — connects messaging platforms to RemoteLab.
 *
 * Usage:
 *   node channels/start.mjs                    # start all enabled channels
 *   node channels/start.mjs --telegram          # start only Telegram
 *   node channels/start.mjs --discord           # start only Discord
 *   node channels/start.mjs --wechat            # start only WeChat
 *
 * Configuration: channels/config.json
 * Or environment variables:
 *   TELEGRAM_TOKEN, DISCORD_TOKEN, WECHAT_CLAWBOT_TOKEN
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load config
let config;
try {
  config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));
} catch {
  config = {};
}

// Environment variable overrides
if (process.env.TELEGRAM_TOKEN) {
  config.telegram = config.telegram || {};
  config.telegram.token = process.env.TELEGRAM_TOKEN;
  config.telegram.enabled = true;
}
if (process.env.DISCORD_TOKEN) {
  config.discord = config.discord || {};
  config.discord.token = process.env.DISCORD_TOKEN;
  config.discord.enabled = true;
}
if (process.env.WECHAT_CLAWBOT_TOKEN) {
  config.wechat = config.wechat || {};
  config.wechat.clawbotToken = process.env.WECHAT_CLAWBOT_TOKEN;
  config.wechat.enabled = true;
}

// Parse CLI args
const args = process.argv.slice(2);
const onlyTelegram = args.includes('--telegram');
const onlyDiscord = args.includes('--discord');
const onlyWechat = args.includes('--wechat');
const filterSpecific = onlyTelegram || onlyDiscord || onlyWechat;

const adapters = [];

async function startChannels() {
  console.log('[channels] Starting channel bridge...');

  // Telegram
  if (config.telegram?.enabled || config.telegram?.token) {
    if (!filterSpecific || onlyTelegram) {
      try {
        const { TelegramAdapter } = await import('./telegram.mjs');
        const adapter = new TelegramAdapter(config.telegram);
        adapters.push(adapter);
        await adapter.start();
      } catch (err) {
        console.error(`[channels] Telegram failed to start: ${err.message}`);
      }
    }
  }

  // Discord
  if (config.discord?.enabled || config.discord?.token) {
    if (!filterSpecific || onlyDiscord) {
      try {
        const { DiscordAdapter } = await import('./discord.mjs');
        const adapter = new DiscordAdapter(config.discord);
        adapters.push(adapter);
        await adapter.start();
      } catch (err) {
        console.error(`[channels] Discord failed to start: ${err.message}`);
      }
    }
  }

  // WeChat
  if (config.wechat?.enabled || config.wechat?.clawbotToken) {
    if (!filterSpecific || onlyWechat) {
      try {
        const { WeChatAdapter } = await import('./wechat.mjs');
        const adapter = new WeChatAdapter(config.wechat);
        adapters.push(adapter);
        await adapter.start();
      } catch (err) {
        console.error(`[channels] WeChat failed to start: ${err.message}`);
      }
    }
  }

  if (adapters.length === 0) {
    console.error('[channels] No channels configured. Set tokens in channels/config.json or via environment variables.');
    console.error('  TELEGRAM_TOKEN=xxx node channels/start.mjs');
    console.error('  DISCORD_TOKEN=xxx node channels/start.mjs');
    console.error('  WECHAT_CLAWBOT_TOKEN=xxx node channels/start.mjs');
    process.exit(1);
  }

  console.log(`[channels] ${adapters.length} channel(s) active`);
}

async function shutdown() {
  console.log('[channels] Shutting down...');
  for (const adapter of adapters) {
    try {
      await adapter.stop();
    } catch (err) {
      console.error(`[channels] Error stopping ${adapter.name}: ${err.message}`);
    }
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

startChannels().catch(err => {
  console.error(`[channels] Fatal: ${err.message}`);
  process.exit(1);
});
