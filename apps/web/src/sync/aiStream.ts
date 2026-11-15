import { useEffect, useRef, useState } from 'react';
import { gameSocketUrl } from '../campaign-context';

export interface AiStreamState {
  turnId: string;
  chatId: string;
  /** Narration received so far for this turn. */
  text: string;
}

/**
 * Follows the GM's in-progress narration on the campaign socket. Deltas are keyed by turn and
 * chat, so a delta for a new turn starts a fresh bubble. A reconnect keeps the text gathered so
 * far; the final persisted message replaces the bubble once the turn leaves the running state.
 */
export function useAiStream(chatId: string | null): AiStreamState | null {
  const [stream, setStream] = useState<AiStreamState | null>(null);
  const activeChat = useRef(chatId);
  useEffect(() => { activeChat.current = chatId; }, [chatId]);

  useEffect(() => {
    let disposed = false, retry: number | undefined;
    let socket: WebSocket | null = null;
    const connect = () => {
      const ws = new WebSocket(gameSocketUrl());
      socket = ws;
      const isCurrent = () => !disposed && socket === ws;
      ws.onclose = () => {
        if (!isCurrent()) return;
        socket = null;
        retry = window.setTimeout(connect, 1500);
      };
      ws.onmessage = (event: MessageEvent<string>) => {
        if (!isCurrent()) return;
        let message: { type?: string; turnId?: string; chatId?: string; text?: string };
        try { message = JSON.parse(event.data) as typeof message; } catch { return; }
        if (message.type !== 'ai-stream' || typeof message.turnId !== 'string' || typeof message.chatId !== 'string' || typeof message.text !== 'string') return;
        if (message.chatId !== activeChat.current) return;
        const { turnId, chatId: target, text } = message;
        setStream(previous => previous && previous.turnId === turnId
          ? { ...previous, text: previous.text + text }
          : { turnId, chatId: target, text });
      };
    };
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retry);
      const ws = socket;
      socket = null;
      ws?.close();
    };
  }, []);

  // A different session never inherits the previous one's partial bubble.
  useEffect(() => { setStream(null); }, [chatId]);

  return stream;
}
