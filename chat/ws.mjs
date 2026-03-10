import { WebSocketServer } from 'ws';
import { isAuthenticated, getAuthSession } from '../lib/auth.mjs';
import { setWss } from './ws-clients.mjs';

export function attachWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  setWss(wss);

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    if (!isAuthenticated(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._authSession = getAuthSession(req);
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    const role = ws._authSession?.role || 'owner';
    console.log(`[ws] Client connected (role=${role})`);

    ws.on('message', () => {
      try {
        ws.close(1008, 'Push-only WebSocket');
      } catch {}
    });

    ws.on('close', () => {
      console.log(`[ws] Client disconnected (role=${role})`);
    });
  });

  return wss;
}
