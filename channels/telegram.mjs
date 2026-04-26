/**
 * Telegram channel adapter — uses grammY for bot interaction.
 *
 * Features:
 * - Long-polling mode (no public IP needed)
 * - Maps Telegram user → RemoteLab session
 * - Slash command menu registered via setMyCommands (OpenClaw pattern)
 * - Markdown formatting for replies
 */

import { Bot } from 'grammy';
import { BaseAdapter } from './base-adapter.mjs';

export class TelegramAdapter extends BaseAdapter {
  constructor(config) {
    super('telegram', config);
    this.bot = null;
  }

  async start() {
    if (!this.config.token) {
      console.warn('[telegram] No token configured, skipping');
      return;
    }

    this.bot = new Bot(this.config.token);

    // Access control
    const allowed = this.config.allowedUsers || [];

    const checkAccess = (ctx) => {
      const userId = String(ctx.from.id);
      const username = ctx.from.username || ctx.from.first_name || userId;
      if (allowed.length > 0 && !allowed.includes(userId) && !allowed.includes(username)) {
        ctx.reply('Access denied. Your user ID: ' + userId);
        return false;
      }
      return true;
    };

    // ---- Register slash command handlers (OpenClaw pattern: bot.command per command) ----
    for (const cmd of this.commands) {
      this.bot.command(cmd.name, async (ctx) => {
        if (!checkAccess(ctx)) return;
        const userId = String(ctx.from.id);
        const key = `${this.prefix}:${userId}`;
        const args = ctx.match || ''; // grammY extracts text after /command
        try {
          const result = await cmd.handler(key, args);
          await ctx.reply(result, { parse_mode: undefined }); // commands always plain text
        } catch (err) {
          console.error(`[telegram] Command /${cmd.name} error: ${err.message}`);
          await ctx.reply(`❌ Error: ${err.message}`);
        }
      });
    }

    // ---- Regular text messages → forward to session ----
    this.bot.on('message:text', async (ctx) => {
      if (!checkAccess(ctx)) return;

      const userId = String(ctx.from.id);
      const username = ctx.from.username || ctx.from.first_name || userId;
      const text = ctx.message.text;

      // Skip if it looks like an unhandled command (shouldn't happen but just in case)
      if (text.startsWith('/')) return;

      // Show typing indicator
      await ctx.replyWithChatAction('typing');

      // Forward to RemoteLab
      try {
        await this.handleIncoming(userId, text, username);
      } catch (err) {
        console.error(`[telegram] Error handling message: ${err.message}`);
        await ctx.reply(`❌ Error: ${err.message}`);
      }
    });

    // Handle photos with caption
    this.bot.on('message:photo', async (ctx) => {
      if (!checkAccess(ctx)) return;
      const userId = String(ctx.from.id);
      const caption = ctx.message.caption || 'User sent a photo';
      await ctx.replyWithChatAction('typing');
      try {
        await this.handleIncoming(userId, caption, ctx.from.username || userId);
      } catch (err) {
        await ctx.reply(`❌ Error: ${err.message}`);
      }
    });

    // Error handler
    this.bot.catch((err) => {
      console.error(`[telegram] Bot error: ${err.message}`);
    });

    // ---- Register command menu with Telegram (setMyCommands) ----
    try {
      const menuCommands = this.commands
        .filter(c => c.name !== 'start') // /start is implicit in Telegram
        .map(c => ({ command: c.name, description: c.description }));
      await this.bot.api.setMyCommands(menuCommands);
      console.log(`[telegram] Registered ${menuCommands.length} commands in menu`);
    } catch (err) {
      console.warn(`[telegram] Failed to set commands menu: ${err.message}`);
    }

    // Start long-polling
    await this.bot.start({
      onStart: () => console.log('[telegram] Bot started (long-polling)'),
    });
  }

  async stop() {
    if (this.bot) {
      await this.bot.stop();
      console.log('[telegram] Bot stopped');
    }
  }

  async sendReply(platformUserId, text) {
    if (!this.bot) return;
    try {
      // Try sending as Markdown, fall back to plain text
      await this.bot.api.sendMessage(platformUserId, text, {
        parse_mode: 'Markdown',
      });
    } catch {
      // Markdown parse error — send as plain text
      try {
        await this.bot.api.sendMessage(platformUserId, text);
      } catch (err) {
        console.error(`[telegram] Failed to send reply to ${platformUserId}: ${err.message}`);
      }
    }
  }
}
