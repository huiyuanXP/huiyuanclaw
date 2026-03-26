#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const templateSource = readFileSync(join(repoRoot, 'templates', 'chat.html'), 'utf8');
const i18nSource = readFileSync(join(repoRoot, 'static', 'chat', 'i18n.js'), 'utf8');

const uploadButtonIndex = templateSource.indexOf('id="imgBtn"');
const toolSelectIndex = templateSource.indexOf('id="inlineToolSelect"');

assert.notEqual(uploadButtonIndex, -1, 'chat template should include the upload button');
assert.notEqual(toolSelectIndex, -1, 'chat template should include the inline tool selector');
assert.ok(uploadButtonIndex < toolSelectIndex, 'upload button should appear before runtime controls in the composer');

assert.match(templateSource, /<span class="img-btn-label" data-i18n="action\.upload">Upload<\/span>/, 'upload button should render a visible text label');
assert.match(templateSource, /title="Attach files" aria-label="Attach files" data-i18n-title="action\.attachFiles" data-i18n-aria-label="action\.attachFiles"/, 'upload button should keep descriptive accessibility text');
assert.match(templateSource, /<span class="img-btn-icon" data-icon="attach" aria-hidden="true"><\/span>/, 'upload button should keep the attachment icon beside the label');

assert.match(i18nSource, /"action\.upload": "Upload"/, 'english UI copy should label the control as Upload');
assert.match(i18nSource, /"action\.attachFiles": "Attach files"/, 'english accessibility copy should describe file uploads clearly');
assert.match(i18nSource, /"action\.upload": "上传"/, 'chinese UI copy should label the control as 上传');
assert.match(i18nSource, /"action\.attachFiles": "上传文件"/, 'chinese accessibility copy should describe file uploads clearly');

console.log('test-chat-upload-button: ok');
