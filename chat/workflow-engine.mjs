import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { homedir } from 'os';
import { createAndRun } from './session-manager.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = join(__dirname, '..', 'workflows');
const RUNS_DIR = join(homedir(), '.config', 'claude-web', 'workflow-runs');

// ---- Placeholder resolution ----

function resolvePlaceholders(prompt, results) {
  return prompt.replace(/\{\{(\w+)\.results\}\}/g, (_, stepId) => {
    if (!results[stepId]) return '[results not available]';
    return Object.entries(results[stepId])
      .map(([id, output]) => `### ${id}\n${output}`)
      .join('\n\n');
  });
}

// ---- Single task runner ----

async function runTask(task, runDir) {
  console.log(`[Workflow] Running task "${task.id}" in ${task.workspace} (model: ${task.model})`);
  const output = await createAndRun(task.workspace, task.model, task.prompt);
  writeFileSync(join(runDir, `${task.id}.txt`), output, 'utf8');
  console.log(`[Workflow] Task "${task.id}" completed (${output.length} chars)`);
  return output;
}

// ---- Main export ----

export async function executeWorkflow(workflowName) {
  const workflowPath = join(WORKFLOWS_DIR, `${workflowName}.json`);
  if (!existsSync(workflowPath)) {
    throw new Error(`Workflow definition not found: ${workflowPath}`);
  }
  const workflow = JSON.parse(readFileSync(workflowPath, 'utf8'));

  const runId = randomBytes(8).toString('hex');
  const runDir = join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  console.log(`[Workflow] Starting "${workflowName}" run=${runId}`);

  const meta = {
    runId,
    workflow: workflowName,
    startedAt: new Date().toISOString(),
    status: 'running',
    steps: {},
  };
  writeFileSync(join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));

  const results = {}; // stepId → { taskId → output }

  try {
    for (const step of workflow.steps) {
      console.log(`[Workflow] Executing step "${step.id}" (type: ${step.type})`);

      const resolvedTasks = step.tasks.map(task => ({
        ...task,
        prompt: resolvePlaceholders(task.prompt, results),
      }));

      if (step.type === 'parallel') {
        // Run all tasks concurrently; use allSettled so one failure doesn't abort the step
        const settled = await Promise.allSettled(
          resolvedTasks.map(async task => {
            const output = await runTask(task, runDir);
            return [task.id, output];
          })
        );
        results[step.id] = Object.fromEntries(
          settled.map((r, i) => [
            resolvedTasks[i].id,
            r.status === 'fulfilled' ? r.value[1] : `[FAILED: ${r.reason?.message ?? 'unknown error'}]`,
          ])
        );
      } else {
        // sequential: run tasks one after another
        results[step.id] = {};
        for (const task of resolvedTasks) {
          const output = await runTask(task, runDir);
          results[step.id][task.id] = output;
        }
      }

      meta.steps[step.id] = { status: 'completed', tasks: Object.keys(results[step.id]) };
    }

    meta.status = 'completed';
    meta.completedAt = new Date().toISOString();
    console.log(`[Workflow] "${workflowName}" run=${runId} completed successfully`);
  } catch (err) {
    meta.status = 'failed';
    meta.error = err.message;
    meta.failedAt = new Date().toISOString();
    console.error(`[Workflow] "${workflowName}" run=${runId} failed:`, err.message);
  }

  writeFileSync(join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));
  return { runId, runDir, meta };
}

// ---- Utility: list recent runs ----

export function listWorkflowRuns(limit = 10) {
  if (!existsSync(RUNS_DIR)) return [];
  try {
    const dirs = readdirSync(RUNS_DIR)
      .map(name => ({ name, mtime: statSync(join(RUNS_DIR, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map(({ name }) => {
        try {
          return JSON.parse(readFileSync(join(RUNS_DIR, name, 'meta.json'), 'utf8'));
        } catch {
          return { runId: name, status: 'unknown' };
        }
      });
    return dirs;
  } catch {
    return [];
  }
}
