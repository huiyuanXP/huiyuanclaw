/**
 * WeChat ClawBot channel adapter — uses official HTTP long-polling API.
 *
 * Based on ResearchCenter research (2026-03-24):
 * - GET /ilink/bot/getupdates?token=xxx  — long-poll for new messages
 * - POST /ilink/bot/sendmessage           — send replies
 *
 * Limitations:
 * - 24-hour message window (user must have messaged within 24h)
 * - Personal chat only (no group chat)
 * - Gradually rolling out (iOS 8.0.70+, Android TBD)
 */

import http from 'http';
import https from 'https';
import { BaseAdapter } from './base-adapter.mjs';

export class WeChatAdapter extends BaseAdapter {
  constructor(config) {
    super('wechat', config);
    this.running = false;
    this.pollTimeout = null;
  }

  async start() {
    if (!this.config.clawbotToken) {
      console.warn('[wechat] No clawbotToken configured, skipping');
      return;
    }

    this.running = true;
    console.log('[wechat] ClawBot adapter starting (long-polling)');
    this._poll();
  }

  async stop() {
    this.running = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
    }
    console.log('[wechat] ClawBot adapter stopped');
  }

  /**
   * Long-poll loop: fetch new messages from ClawBot, process each, repeat.
   */
  async _poll() {
    if (!this.running) return;

    try {
      const updates = await this._getUpdates();
      if (updates && Array.isArray(updates)) {
        for (const update of updates) {
          await this._processUpdate(update);
        }
      }
    } catch (err) {
      console.error(`[wechat] Poll error: ${err.message}`);
    }

    // Continue polling (with a small delay on error to avoid tight loops)
    if (this.running) {
      this.pollTimeout = setTimeout(() => this._poll(), 500);
    }
  }

  async _processUpdate(update) {
    // Extract sender and message from update
    // The exact format depends on ClawBot API; adapting from research docs
    const senderId = update.from?.id || update.sender_id || update.chat_id;
    const text = update.message?.text || update.text || update.content;
    const displayName = update.from?.name || update.sender_name || String(senderId);

    if (!senderId || !text) return;

    const userId = String(senderId);

    // Handle commands
    if (text.startsWith('/')) {
      const cmdResult = this.handleCommand(userId, text);
      if (cmdResult) {
        const reply = cmdResult instanceof Promise ? await cmdResult : cmdResult;
        await this.sendReply(userId, reply);
        return;
      }
    }

    // Forward to RemoteLab
    try {
      await this.handleIncoming(userId, text, displayName);
    } catch (err) {
      console.error(`[wechat] Error handling message from ${userId}: ${err.message}`);
      await this.sendReply(userId, `Error: ${err.message}`);
    }
  }

  /**
   * GET /ilink/bot/getupdates?token=xxx — long-poll for messages.
   */
  _getUpdates() {
    return new Promise((resolve, reject) => {
      const baseUrl = this.config.pollUrl || 'https://szminibots-wechat.weixin.qq.com';
      const url = new URL(`/ilink/bot/getupdates?token=${encodeURIComponent(this.config.clawbotToken)}`, baseUrl);

      const client = url.protocol === 'https:' ? https : http;
      const req = client.get(url, { timeout: 60000 }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.updates || parsed.result || parsed.messages || []);
          } catch {
            resolve([]);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        resolve([]); // Timeout is normal for long-polling
      });
    });
  }

  /**
   * POST /ilink/bot/sendmessage — send reply to user.
   */
  async sendReply(platformUserId, text) {
    const baseUrl = this.config.pollUrl || 'https://szminibots-wechat.weixin.qq.com';
    const url = new URL('/ilink/bot/sendmessage', baseUrl);

    const body = JSON.stringify({
      token: this.config.clawbotToken,
      chat_id: platformUserId,
      text: text,
    });

    return new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            console.error(`[wechat] sendmessage failed (${res.statusCode}): ${data}`);
          }
          resolve();
        });
      });

      req.on('error', (err) => {
        console.error(`[wechat] sendmessage error: ${err.message}`);
        resolve(); // Don't crash on send failure
      });

      req.write(body);
      req.end();
    });
  }
}
