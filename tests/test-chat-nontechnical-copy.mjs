#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const templateSource = readFileSync(join(repoRoot, 'templates', 'chat.html'), 'utf8');
const i18nSource = readFileSync(join(repoRoot, 'static', 'chat', 'i18n.js'), 'utf8');

assert.match(templateSource, /Create reusable apps or workflows here\./);
assert.match(templateSource, /Optional behavior instructions for this app/);
assert.match(templateSource, /View project source ↗/);
assert.match(templateSource, /Advanced integration/);
assert.match(templateSource, /Copy setup brief/);
assert.match(templateSource, /dedicated technical session/);
assert.doesNotMatch(templateSource, /Open source on GitHub ↗/);
assert.doesNotMatch(templateSource, /Optional system prompt for this app/);
assert.doesNotMatch(templateSource, /Advanced provider code/);
assert.doesNotMatch(templateSource, /Copy base prompt/);
assert.doesNotMatch(templateSource, /open a new session in the RemoteLab repo/);

assert.match(i18nSource, /"footer\.openSource": "View project source ↗"/);
assert.match(i18nSource, /"settings\.apps\.note": "Create reusable apps or workflows here\./);
assert.match(i18nSource, /"settings\.apps\.systemPromptPlaceholder": "Optional behavior instructions for this app"/);
assert.match(i18nSource, /"modal\.advancedTitle": "Advanced integration"/);
assert.match(i18nSource, /"modal\.copyBasePrompt": "Copy setup brief"/);
assert.match(i18nSource, /"modal\.advancedBody": "If the simple setup is not enough, start a dedicated technical session and paste this setup brief\."/);
assert.match(i18nSource, /"footer\.openSource": "查看项目源码 ↗"/);
assert.match(i18nSource, /"settings\.apps\.systemPromptPlaceholder": "这个应用的可选行为说明"/);
assert.match(i18nSource, /"modal\.advancedTitle": "高级集成"/);
assert.match(i18nSource, /"modal\.advancedBody": "如果简单配置不够，就新开一个专门处理技术集成的会话，把这段设置说明贴进去。"/);
assert.doesNotMatch(i18nSource, /"footer\.openSource": "Open source on GitHub ↗"/);
assert.doesNotMatch(i18nSource, /"footer\.openSource": "GitHub 开源项目 ↗"/);
assert.doesNotMatch(i18nSource, /"settings\.apps\.systemPromptPlaceholder": "Optional system prompt for this app"/);
assert.doesNotMatch(i18nSource, /"settings\.apps\.systemPromptPlaceholder": "这个应用的可选系统提示词"/);
assert.doesNotMatch(i18nSource, /RemoteLab repo/);
assert.doesNotMatch(i18nSource, /RemoteLab 仓库里新开一个会话/);

console.log('test-chat-nontechnical-copy: ok');
