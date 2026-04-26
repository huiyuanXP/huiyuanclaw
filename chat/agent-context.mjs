import { existsSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const MAX_SECTION_CHARS = 12000;
const MAX_TOTAL_CHARS = 48000;
const MAX_DISCOVERED_FILES = 24;
const AGENT_FILE_NAMES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'MEMORY.md',
]);
const AGENT_DIR_NAMES = new Set(['agent', 'agents', '.agents']);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function utc8Date(offsetDays = 0) {
  const now = new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 24 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

function safeRead(path) {
  try {
    const content = readFileSync(path, 'utf8').trim();
    if (!content) return '';
    if (content.length <= MAX_SECTION_CHARS) return content;
    return `${content.slice(0, MAX_SECTION_CHARS)}\n\n[Truncated by RemoteLab]`;
  } catch {
    return '';
  }
}

function pushSection(sections, label, path, rootDir) {
  if (!existsSync(path)) return;
  const content = safeRead(path);
  if (!content) return;
  const displayPath = rootDir ? relative(rootDir, path) || basename(path) : path;
  sections.push(`--- ${label}: ${displayPath} ---\n${content}`);
}

function pushInlineSection(sections, label, content) {
  const text = (content || '').trim();
  if (!text) return;
  sections.push(`--- ${label} ---\n${text}`);
}

function isWithin(root, target) {
  if (!target) return false;
  const rel = relative(root, resolve(target));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('../'));
}

function extractHeredoc(source, marker) {
  const re = new RegExp(`<<\\s*'?${marker}'?\\n([\\s\\S]*?)\\n${marker}`, 'm');
  const match = source.match(re);
  return match ? match[1].trim() : '';
}

function collectRepoAgentArchetypes(folder) {
  if (!isWithin(REPO_ROOT, folder)) return [];

  const sections = [];
  const setupPath = join(REPO_ROOT, 'setup-workspace.sh');
  const readmePath = join(REPO_ROOT, 'README.md');
  const setup = existsSync(setupPath) ? readFileSync(setupPath, 'utf8') : '';
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';

  if (setup) {
    const setupBlocks = [
      ['Repo Shared Template USER.md', extractHeredoc(setup, 'USEREOF')],
      ['Repo Shared Template SOUL.md', extractHeredoc(setup, 'SOULEOF')],
      ['Repo Shared Template TOOLS.md', extractHeredoc(setup, 'TOOLSEOF')],
      ['Repo Shared Template MEMORY.md', extractHeredoc(setup, 'MEMEOF')],
      ['Repo Orchestrator Template CLAUDE.md', extractHeredoc(setup, 'CLAUDEEOF')],
      ['Repo Orchestrator Template AGENTS.md', extractHeredoc(setup, 'AGENTSEOF')],
      ['Repo Sub-Workspace Template CLAUDE.md', extractHeredoc(setup, 'SUBEOF')],
    ];

    for (const [label, content] of setupBlocks) {
      pushInlineSection(sections, label, content);
    }
  }

  if (readme) {
    const softwareDev = readme.match(/\|\s*`software-dev`\s*\|\s*([^|]+)\|\s*([^|]+)\|/);
    const research = readme.match(/\|\s*`research`\s*\|\s*([^|]+)\|\s*([^|]+)\|/);
    if (softwareDev) {
      pushInlineSection(
        sections,
        'Repo Team Template software-dev',
        `Roles: ${softwareDev[1].trim()}\nFlow: ${softwareDev[2].trim()}`,
      );
    }
    if (research) {
      pushInlineSection(
        sections,
        'Repo Team Template research',
        `Roles: ${research[1].trim()}\nFlow: ${research[2].trim()}`,
      );
    }
  }

  return sections;
}

function collectSharedProfileSections() {
  const base = join(homedir(), '.huiyuanclaw');
  if (!existsSync(base)) return [];

  const sections = [];
  const files = [
    { label: 'Shared Profile', path: join(base, 'USER.md') },
    { label: 'Shared Role', path: join(base, 'SOUL.md') },
    { label: 'Shared Tools', path: join(base, 'TOOLS.md') },
    { label: 'Shared Memory', path: join(base, 'MEMORY.md') },
    { label: 'Shared Daily Log', path: join(base, 'memory', `${utc8Date()}.md`) },
  ];

  for (const file of files) {
    pushSection(sections, file.label, file.path);
  }
  return sections;
}

function collectAncestorInstructionFiles(folder) {
  if (!folder) return [];

  const sections = [];
  const seen = new Set();
  let current = resolve(folder);

  while (true) {
    for (const name of AGENT_FILE_NAMES) {
      const path = join(current, name);
      if (existsSync(path) && !seen.has(path)) {
        seen.add(path);
        pushSection(sections, 'Workspace Instruction', path, folder);
      }
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return sections.reverse();
}

function discoverNestedAgentFiles(folder) {
  if (!folder || !existsSync(folder)) return [];

  const sections = [];
  const queue = [{ dir: resolve(folder), depth: 0 }];
  const seen = new Set();

  while (queue.length > 0 && sections.length < MAX_DISCOVERED_FILES) {
    const { dir, depth } = queue.shift();
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth >= 3) continue;
        if (AGENT_DIR_NAMES.has(entry.name) || depth < 2) {
          queue.push({ dir: path, depth: depth + 1 });
        }
        continue;
      }

      if (!entry.isFile()) continue;
      const isNamedAgentFile = AGENT_FILE_NAMES.has(entry.name);
      const isPatternAgentFile = /\.agent\.md$/i.test(entry.name) || /\.agents\.md$/i.test(entry.name);
      if (!isNamedAgentFile && !isPatternAgentFile) continue;
      if (seen.has(path)) continue;
      seen.add(path);
      pushSection(sections, 'Discovered Agent File', path, folder);
      if (sections.length >= MAX_DISCOVERED_FILES) break;
    }
  }

  return sections;
}

function collectWorkspaceMemorySections(folder) {
  if (!folder) return [];
  const sections = [];
  const memoryDir = join(resolve(folder), 'memory');
  const dates = [utc8Date(), utc8Date(-1)];
  for (const date of dates) {
    pushSection(sections, 'Workspace Memory', join(memoryDir, `${date}.md`), folder);
  }
  return sections;
}

export function buildAgentContext(folder) {
  const sections = [
    ...collectSharedProfileSections(),
    ...collectAncestorInstructionFiles(folder),
    ...discoverNestedAgentFiles(folder),
    ...collectWorkspaceMemorySections(folder),
    ...collectRepoAgentArchetypes(folder),
  ];

  if (sections.length === 0) return '';

  let used = 0;
  const selected = [];
  for (const section of sections) {
    if (used >= MAX_TOTAL_CHARS) break;
    const remaining = MAX_TOTAL_CHARS - used;
    const text = section.length <= remaining
      ? section
      : `${section.slice(0, remaining)}\n\n[Truncated by RemoteLab]`;
    selected.push(text);
    used += text.length;
  }

  return `=== RemoteLab Agent Context (auto-loaded) ===\n\n${selected.join('\n\n')}`;
}
