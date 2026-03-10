import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const runnerEntry = join(__dirname, 'runner-sidecar.mjs');

export function spawnDetachedRunner(runId) {
  const child = spawn(process.execPath, [runnerEntry, runId], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();
  return { pid: child.pid };
}
