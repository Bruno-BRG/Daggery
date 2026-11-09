import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientRollMessage, RollLogEntry, ServerMessage } from '@daggery/shared';
import { gameSocketUrl, reportSyncError } from './campaign-context';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

const LOG_LIMIT = 50;

/** Connects to the server's /ws endpoint and keeps the shared roll log in sync. */
export function useRollLog() {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [rolls, setRolls] = useState<RollLogEntry[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    let retry: number | undefined;

    const connect = () => {
      const socket = new WebSocket(gameSocketUrl());
      socketRef.current = socket;

      // StrictMode mounts twice in dev, and reconnects replace the socket. Ignore stale events.
      const isCurrent = () => !disposed && socketRef.current === socket;

      socket.onopen = () => {
        if (!isCurrent()) return;
        setStatus('open');
      };
      socket.onclose = () => {
        if (!isCurrent()) return;
        socketRef.current = null;
        setStatus('closed');
        retry = window.setTimeout(connect, 1500);
      };
      socket.onmessage = (event: MessageEvent<string>) => {
        if (!isCurrent()) return;
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        switch (message.type) {
          case 'hello':
            setRolls(message.rolls);
            break;
          case 'roll':
            setRolls((previous) => [...previous, message.entry].slice(-LOG_LIMIT));
            break;
          case 'error':
            reportSyncError(message.message);
            break;
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retry);
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    };
  }, []);

  const sendRoll = useCallback((message: ClientRollMessage) => {
    const data = JSON.stringify(message);
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(data);
    else reportSyncError('No connection: the roll was not saved.');
  }, []);

  return { status, rolls, sendRoll };
}
