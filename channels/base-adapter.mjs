/**
 * Base channel adapter — handles common logic for bridging
 * a messaging platform to RemoteLab sessions.
 *
 * Subclasses implement: start(), stop(), sendReply(platformUserId, text)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as api from './api-client.mjs';
import { getChatSettings } from '../lib/runtime-settings.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPPINGS_FILE = join(__dirname, 'session-mappings.json');

// platformKey (e.g. "tg:12345") → { sessionId, folder, lastCheckedIndex }
let mappings = {};

function loadMappings() {
  try {
    if (existsSync(MAPPINGS_FILE)) {
      mappings = JSON.parse(readFileSync(MAPPINGS_FILE, 'utf8'));
    }
  } catch { mappings = {}; }
}

function saveMappings() {
  writeFileSync(MAPPINGS_FILE, JSON.stringify(mappings, null, 2));
}

loadMappings();

export class BaseAdapter {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.prefix = config.sessionPrefix || name;
    this.defaultFolder = config.defaultFolder || '~/RLOrchestrator';
    this.pollIntervals = new Map(); // platformKey → interval
  }

  /** Override in subclass */
  async start() { throw new Error('start() not implemented'); }
  async stop() { throw new Error('stop() not implemented'); }
  async sendReply(platformUserId, text) { throw new Error('sendReply() not implemented'); }

  /**
   * Called by subclass when a message arrives from a platform user.
   * Creates or reuses a RemoteLab session, forwards the message, and starts polling for reply.
   */
  async handleIncoming(platformUserId, text, displayName = '') {
    const key = `${this.prefix}:${platformUserId}`;
    let mapping = mappings[key];

    // Create session if needed
    if (!mapping || !mapping.sessionId) {
      const sessionName = `${this.name}/${displayName || platformUserId}`;
      const folder = this.resolveFolder(this.defaultFolder);
      const chatSettings = getChatSettings();
      const defaultTool = chatSettings.defaultTool || 'codex';
      console.log(`[${this.name}] Creating session for ${key} in ${folder}`);
      const result = await api.createSession(folder, defaultTool, sessionName);
      const sid = result?.id || result?.sessionId;
      if (!sid) {
        console.error(`[${this.name}] Failed to create session, API returned:`, result);
        throw new Error('Failed to create session');
      }
      mapping = {
        sessionId: sid,
        folder,
        lastCheckedIndex: 0,
      };
      mappings[key] = mapping;
      saveMappings();
    }

    // Send message to session
    console.log(`[${this.name}] ${key} → session ${mapping.sessionId.slice(0, 8)}: "${text.slice(0, 60)}"`);
    await api.sendMessage(mapping.sessionId, text);

    // Start polling for response
    this.startPolling(key, platformUserId);
  }

  /**
   * Poll session history for new assistant messages and send them back.
   */
  startPolling(key, platformUserId) {
    // Clear any existing poll for this user
    if (this.pollIntervals.has(key)) {
      clearInterval(this.pollIntervals.get(key));
    }

    const mapping = mappings[key];
    let attempts = 0;
    const maxAttempts = 180; // 3 minutes at 1s intervals

    const interval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        this.pollIntervals.delete(key);
        return;
      }

      try {
        const history = await api.getHistory(mapping.sessionId);
        if (!Array.isArray(history)) return;

        // Find new assistant messages after lastCheckedIndex
        const newMessages = [];
        for (let i = mapping.lastCheckedIndex; i < history.length; i++) {
          const evt = history[i];
          if (evt.role === 'assistant' && evt.content) {
            newMessages.push(evt.content);
          }
        }

        if (newMessages.length > 0) {
          mapping.lastCheckedIndex = history.length;
          saveMappings();

          const fullReply = newMessages.join('\n\n');
          // Split long messages (most platforms have limits)
          const chunks = this.splitMessage(fullReply, 4000);
          for (const chunk of chunks) {
            await this.sendReply(platformUserId, chunk);
          }

          // Check if session is idle (response complete)
          const session = await api.getSession(mapping.sessionId);
          if (session && session.status === 'idle') {
            clearInterval(interval);
            this.pollIntervals.delete(key);
          }
        }
      } catch (err) {
        console.error(`[${this.name}] Poll error for ${key}: ${err.message}`);
      }
    }, 1000);

    this.pollIntervals.set(key, interval);
  }

  /**
   * Command definitions — shared across all platforms.
   * Each: { name, description, handler(key, args) → string|Promise<string> }
   */
  get commands() {
    return [
      // ---- Session management ----
      {
        name: 'new',
        description: 'Start a new session (optionally in a workspace)',
        handler: async (key, args) => {
          // Clear existing mapping
          delete mappings[key];
          // If args provided, treat as folder path
          if (args) {
            mappings[`${key}:folder`] = args;
          }
          saveMappings();
          return '✅ New session will be created on your next message.' +
            (args ? `\nWorkspace: ${args}` : '');
        },
      },
      {
        name: 'sessions',
        description: 'List all active sessions',
        handler: async (key) => {
          const sessions = await api.listSessions();
          if (!sessions || sessions.length === 0) return 'No active sessions.';
          const currentSid = mappings[key]?.sessionId;
          return sessions
            .filter(s => !s.archived)
            .slice(0, 15)
            .map(s => {
              const marker = s.id === currentSid ? ' ← you' : '';
              const name = s.name || s.id.slice(0, 8);
              const folder = s.folder?.split('/').pop() || '';
              return `${s.status === 'running' ? '🟢' : '⚪'} ${name} [${folder}]${marker}`;
            })
            .join('\n');
        },
      },
      {
        name: 'attach',
        description: 'Attach to an existing session by ID or name',
        handler: async (key, args) => {
          if (!args) return '❌ Usage: /attach <session-id or name>';
          const query = args.trim().toLowerCase();
          // Try exact match first, then prefix match, then name search
          let session = await api.getSession(query);
          if (!session) {
            const all = await api.listSessions();
            if (Array.isArray(all)) {
              const match = all.find(s =>
                s.id.startsWith(query) ||
                (s.name && s.name.toLowerCase().includes(query))
              );
              if (match) session = match;
            }
          }
          if (!session) return `❌ No session matching "${args.trim()}" found.`;
          mappings[key] = {
            sessionId: session.id,
            folder: session.folder || '',
            lastCheckedIndex: 0,
          };
          saveMappings();
          return `✅ Attached to "${session.name || session.id.slice(0, 8)}"`;
        },
      },
      {
        name: 'detach',
        description: 'Detach from current session',
        handler: async (key) => {
          const sid = mappings[key]?.sessionId;
          delete mappings[key];
          saveMappings();
          return sid
            ? `Detached from ${sid.slice(0, 8)}. Next message creates a new session.`
            : 'No session attached.';
        },
      },

      // ---- Workspace ----
      {
        name: 'workspace',
        description: 'Switch workspace folder',
        handler: async (key, args) => {
          if (!args) {
            const current = mappings[key]?.folder || mappings[`${key}:folder`] || this.defaultFolder;
            return `Current workspace: ${current}`;
          }
          delete mappings[key]; // clear session so next msg creates new one
          mappings[`${key}:folder`] = args.trim();
          saveMappings();
          return `✅ Workspace → ${args.trim()}\nNext message will create a new session there.`;
        },
      },
      {
        name: 'folders',
        description: 'List available workspace folders',
        handler: async () => {
          const folders = await api.listFolders();
          if (!folders || !Array.isArray(folders) || folders.length === 0) {
            return 'No folders found.';
          }
          return folders.map(f => {
            const path = f.folder || f.path || f.name || String(f);
            const name = path.split('/').pop();
            const count = f.sessionCount != null ? ` (${f.sessionCount})` : '';
            return `📁 ${name}${count}`;
          }).join('\n');
        },
      },

      // ---- Status & info ----
      {
        name: 'status',
        description: 'Show current session status',
        handler: async (key) => {
          const mapping = mappings[key];
          if (!mapping?.sessionId) return 'No session attached. Send a message to start one.';
          const session = await api.getSession(mapping.sessionId);
          if (!session) return '❌ Session not found (may have been deleted).';
          const lines = [
            `📋 Session: ${session.name || session.id.slice(0, 8)}`,
            `   ID: ${session.id}`,
            `   Status: ${session.status === 'running' ? '🟢 running' : '⚪ idle'}`,
            `   Folder: ${session.folder?.split('/').pop() || session.folder}`,
            `   Tool: ${session.tool || 'codex'}`,
          ];
          if (session.label) lines.push(`   Label: ${session.label}`);
          return lines.join('\n');
        },
      },
      {
        name: 'history',
        description: 'Show recent messages from current session',
        handler: async (key, args) => {
          const mapping = mappings[key];
          if (!mapping?.sessionId) return 'No session attached.';
          const history = await api.getHistory(mapping.sessionId);
          if (!Array.isArray(history) || history.length === 0) return 'No history yet.';
          const count = parseInt(args) || 5;
          const recent = history.slice(-count * 2); // get last N exchanges
          return recent.map(evt => {
            const role = evt.role === 'user' ? '👤' : '🤖';
            const text = (evt.content || '').slice(0, 200);
            return `${role} ${text}${evt.content?.length > 200 ? '...' : ''}`;
          }).join('\n\n');
        },
      },
      {
        name: 'whoami',
        description: 'Show your platform user ID and mapping',
        handler: async (key) => {
          const mapping = mappings[key];
          const lines = [`🆔 Key: ${key}`];
          if (mapping?.sessionId) {
            lines.push(`📎 Session: ${mapping.sessionId.slice(0, 8)}`);
            lines.push(`📁 Folder: ${mapping.folder || 'default'}`);
          } else {
            lines.push('📎 No session attached');
          }
          return lines.join('\n');
        },
      },

      // ---- Actions ----
      {
        name: 'stop',
        description: 'Stop the current running session',
        handler: async (key) => {
          const mapping = mappings[key];
          if (!mapping?.sessionId) return 'No session attached.';
          // Send interrupt via a special message
          await api.sendMessage(mapping.sessionId, '/stop', { isSystemNotification: true });
          return `⏹ Stop signal sent to ${mapping.sessionId.slice(0, 8)}.`;
        },
      },

      // ---- Help ----
      {
        name: 'help',
        description: 'Show all available commands',
        handler: async () => {
          return '🔧 RemoteLab Commands:\n\n' + this.commands
            .map(c => `/${c.name} — ${c.description}`)
            .join('\n');
        },
      },
      {
        name: 'start',
        description: 'Welcome message',
        handler: async () => {
          return '👋 Welcome to RemoteLab!\n\n' +
            'Send any message to start a conversation with your AI agent.\n\n' +
            'Use /help to see all commands, or /folders to see available workspaces.';
        },
      },
    ];
  }

  /**
   * Handle slash commands. Returns string/Promise<string> or null if not a command.
   */
  handleCommand(platformUserId, text) {
    const key = `${this.prefix}:${platformUserId}`;

    // Parse: "/command args" or "/command@botname args"
    const match = text.match(/^\/(\w+)(?:@\S+)?\s*(.*)?$/s);
    if (!match) return null;

    const cmdName = match[1].toLowerCase();
    const args = (match[2] || '').trim();

    const cmd = this.commands.find(c => c.name === cmdName);
    if (!cmd) return null;

    return cmd.handler(key, args);
  }

  resolveFolder(folder) {
    if (folder.startsWith('~')) {
      return folder.replace('~', process.env.HOME || '/home/ally');
    }
    return folder;
  }

  splitMessage(text, maxLen) {
    if (text.length <= maxLen) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      // Try to split at a newline
      let splitAt = remaining.lastIndexOf('\n', maxLen);
      if (splitAt < maxLen * 0.3) splitAt = maxLen;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    return chunks;
  }
}
