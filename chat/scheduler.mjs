import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = join(__dirname, '..', 'workflows');
const SCHEDULES_FILE = join(WORKFLOWS_DIR, 'schedules.json');

// Parse "minute hour * * *" cron (daily-only subset)
function parseDailyCron(cron) {
  const parts = cron.split(' ');
  return { minute: parseInt(parts[0], 10), hour: parseInt(parts[1], 10) };
}

// Milliseconds until next occurrence of hour:minute
function msUntilNext(hour, minute) {
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function loadSchedules() {
  try {
    return JSON.parse(readFileSync(SCHEDULES_FILE, 'utf8'));
  } catch (err) {
    console.error('[Scheduler] Failed to load schedules.json:', err.message);
    return { schedules: [] };
  }
}

function updateLastRun(scheduleId) {
  try {
    const data = loadSchedules();
    const s = data.schedules.find(s => s.id === scheduleId);
    if (s) {
      s.lastRun = new Date().toISOString();
      writeFileSync(SCHEDULES_FILE, JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error('[Scheduler] Failed to update lastRun:', err.message);
  }
}

// Ensure workflows dir exists (schedules.json may be missing on first run)
function ensureWorkflowsDir() {
  if (!existsSync(WORKFLOWS_DIR)) mkdirSync(WORKFLOWS_DIR, { recursive: true });
}

export function startScheduler(onTrigger) {
  ensureWorkflowsDir();

  function scheduleAll() {
    const data = loadSchedules();

    for (const schedule of data.schedules) {
      if (!schedule.enabled) continue;
      if (!schedule.cron) continue; // manual-only: no auto-schedule

      const { hour, minute } = parseDailyCron(schedule.cron);

      // Missed-run detection: if server restarted after the expected run time today
      if (schedule.lastRun !== null) {
        const lastRun = new Date(schedule.lastRun);
        const expectedToday = new Date();
        expectedToday.setHours(hour, minute, 0, 0);
        const now = new Date();
        if (lastRun < expectedToday && expectedToday <= now) {
          console.log(`[Scheduler] Missed run detected for "${schedule.id}", triggering now`);
          try { onTrigger(schedule); } catch (err) { console.error('[Scheduler] onTrigger error:', err); }
          updateLastRun(schedule.id);
        }
      }

      const delay = msUntilNext(hour, minute);
      const delayMin = Math.round(delay / 1000 / 60);
      console.log(`[Scheduler] "${schedule.id}" scheduled in ${delayMin} min (${hour}:${String(minute).padStart(2, '0')})`);

      setTimeout(() => {
        console.log(`[Scheduler] Triggering "${schedule.id}"`);
        try { onTrigger(schedule); } catch (err) { console.error('[Scheduler] onTrigger error:', err); }
        updateLastRun(schedule.id);
        // Re-schedule for the next day
        scheduleAll();
      }, delay);
    }
  }

  scheduleAll();
}
