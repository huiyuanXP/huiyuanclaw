export function parseSessionGetRoute(pathname) {
  if (pathname === '/api/sessions') {
    return { kind: 'list' };
  }

  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'sessions') {
    return null;
  }

  const sessionId = parts[2];
  if (!sessionId) {
    return null;
  }

  if (parts.length === 3) {
    return { kind: 'detail', sessionId };
  }

  if (parts.length === 4 && parts[3] === 'events') {
    return { kind: 'events', sessionId };
  }

  if (parts.length === 6 && parts[3] === 'events' && parts[5] === 'body') {
    const seq = parseInt(parts[4], 10);
    if (!Number.isInteger(seq) || seq < 1) return null;
    return { kind: 'event-body', sessionId, seq };
  }

  return null;
}
