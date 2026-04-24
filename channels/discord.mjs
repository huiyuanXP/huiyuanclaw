/**
 * Discord channel adapter — uses discord.js v14.
 *
 * Features:
 * - Gateway connection (WebSocket)
 * - Maps Discord user → RemoteLab session
 * - Supports DM and channel mentions
 * - Slash commands: /workspace, /sessions, /attach, /detach
 * - Splits long messages (Discord 2000 char limit)
 */

import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { BaseAdapter } from './base-adapter.mjs';

export class DiscordAdapter extends BaseAdapter {
  constructor(config) {
    super('discord', config);
    this.client = null;
  }

  async start() {
    if (!this.config.token) {
      console.warn('[discord] No token configured, skipping');
      return;
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel], // Required for DMs
    });

    const allowed = this.config.allowedUsers || [];

    this.client.on(Events.MessageCreate, async (msg) => {
      // Ignore bot messages
      if (msg.author.bot) return;

      const userId = msg.author.id;
      const username = msg.author.username || userId;

      // In guild channels, only respond to mentions
      if (msg.guild) {
        const mentioned = msg.mentions.has(this.client.user);
        if (!mentioned) return;
      }

      // Access control
      if (allowed.length > 0 && !allowed.includes(userId) && !allowed.includes(username)) {
        await msg.reply('Access denied. Your user ID: ' + userId);
        return;
      }

      // Strip bot mention from text
      let text = msg.content;
      if (this.client.user) {
        text = text.replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '').trim();
      }
      if (!text) return;

      // Handle commands
      if (text.startsWith('/')) {
        const cmdResult = this.handleCommand(userId, text);
        if (cmdResult) {
          const reply = cmdResult instanceof Promise ? await cmdResult : cmdResult;
          await msg.reply(reply);
          return;
        }
      }

      // Show typing
      try { await msg.channel.sendTyping(); } catch {}

      // Forward to RemoteLab
      try {
        await this.handleIncoming(userId, text, username);
      } catch (err) {
        console.error(`[discord] Error handling message: ${err.message}`);
        await msg.reply(`Error: ${err.message}`);
      }
    });

    this.client.on(Events.Error, (err) => {
      console.error(`[discord] Client error: ${err.message}`);
    });

    await this.client.login(this.config.token);
    console.log(`[discord] Bot logged in as ${this.client.user?.tag}`);
  }

  async stop() {
    if (this.client) {
      await this.client.destroy();
      console.log('[discord] Bot stopped');
    }
  }

  async sendReply(platformUserId, text) {
    if (!this.client) return;
    try {
      const user = await this.client.users.fetch(platformUserId);
      const dm = await user.createDM();
      // Discord limit is 2000 chars
      const chunks = this.splitMessage(text, 1900);
      for (const chunk of chunks) {
        await dm.send(chunk);
      }
    } catch (err) {
      console.error(`[discord] Failed to send reply to ${platformUserId}: ${err.message}`);
    }
  }
}
