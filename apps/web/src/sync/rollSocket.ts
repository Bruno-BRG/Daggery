import type { ClientRollMessage } from '@daggery/shared';
import { gameSocketUrl, reportSyncError } from '../campaign-context';
let socket: WebSocket | null = null;
let pending: string[] = [];
function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const ws = new WebSocket(gameSocketUrl());
  socket = ws;
  ws.onopen = () => {
    if (socket !== ws) return;
    const messages = pending; pending = [];
    for (const message of messages) ws.send(message);
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    if (pending.length) reportSyncError('No connection: the roll was not saved.');
    pending = [];
  };
  ws.onmessage = (event: MessageEvent<string>) => {
    try { const m = JSON.parse(event.data) as { type?: string; message?: string }; if (m.type === 'error') reportSyncError(m.message ?? 'Roll rejected'); } catch { /* ignore invalid messages */ }
  };
}
export function sendRoll(message: ClientRollMessage): void {
  connect();
  const data = JSON.stringify(message);
  if (socket?.readyState === WebSocket.OPEN) socket.send(data);
  else if (pending.length < 20) pending.push(data);
  else reportSyncError('Could not send the roll.');
}
