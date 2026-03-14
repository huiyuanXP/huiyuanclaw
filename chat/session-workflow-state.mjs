export const SESSION_WORKFLOW_STATE_PARKED = 'parked';
export const SESSION_WORKFLOW_STATE_WAITING_USER = 'waiting_user';
export const SESSION_WORKFLOW_STATE_DONE = 'done';

export const SESSION_WORKFLOW_STATES = Object.freeze([
  SESSION_WORKFLOW_STATE_PARKED,
  SESSION_WORKFLOW_STATE_WAITING_USER,
  SESSION_WORKFLOW_STATE_DONE,
]);

export function normalizeSessionWorkflowState(value) {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : '';
  if (!normalized) return '';

  switch (normalized) {
    case 'parked':
    case 'paused':
    case 'pause':
    case 'backlog':
    case 'todo':
      return SESSION_WORKFLOW_STATE_PARKED;

    case 'waiting':
    case 'waiting_user':
    case 'waiting_for_user':
    case 'waiting_on_user':
    case 'needs_user':
    case 'needs_input':
      return SESSION_WORKFLOW_STATE_WAITING_USER;

    case 'done':
    case 'complete':
    case 'completed':
    case 'finished':
      return SESSION_WORKFLOW_STATE_DONE;

    default:
      return '';
  }
}

export function inferSessionWorkflowStateFromText(value) {
  const normalized = normalizeSessionWorkflowState(value);
  if (normalized) return normalized;

  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text) return '';

  if (/(waiting|need(?:s)? (?:the )?user|need(?:s)? input|need(?:s)? approval|need(?:s)? confirmation|please provide|please upload|please answer|manual validation|user action)/.test(text)) {
    return SESSION_WORKFLOW_STATE_WAITING_USER;
  }

  if (/(done|complete(?:d)?|finish(?:ed)?|resolved|closed|successfully completed)/.test(text)) {
    return SESSION_WORKFLOW_STATE_DONE;
  }

  if (/(parked|paused|backlog|deferred|resume later|pick up later)/.test(text)) {
    return SESSION_WORKFLOW_STATE_PARKED;
  }

  return '';
}
