import assert from 'assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'remotelab-system-prompt-'));
process.env.HOME = tempHome;

const { buildSystemContext } = await import('../chat/system-prompt.mjs');

const context = await buildSystemContext({ sessionId: 'session-test-123' });

assert.match(context, /Template-Session-First Routing/);
assert.match(context, /Manager Policy Boundary/);
assert.match(context, /Treat provider runtimes such as Codex or Claude as execution engines/);
assert.match(context, /For normal conversation and conceptual discussion, default to natural connected prose/);
assert.match(context, /reusable template\/base session likely exists/);
assert.match(context, /clean, comprehensive project-task context/);
assert.match(context, /improve it or derive a better template\/base/);
assert.match(context, /saved template context as bootstrap, not eternal truth/);
assert.match(context, /fresh working child\/fork/);
assert.match(context, /approximate the behavior by loading the best matching template context/);
assert.match(context, /Parallel Session Spawning/);
assert.match(context, /not primarily a user-facing UI action/);
assert.match(context, /independent worker that simply received bounded handoff context/);
assert.match(context, /remotelab session-spawn --task/);
assert.match(context, /--wait --json/);
assert.match(context, /REMOTELAB_SESSION_ID/);
assert.match(context, /session-test-123/);

console.log('test-system-prompt: ok');
