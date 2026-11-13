import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { gameSocketUrl, getActiveCampaign, reportSyncError } from '../campaign-context';

type Listener = () => void;
const state = new Map<string, Map<string, unknown>>();
const snapshots = new Map<string, Record<string, unknown>>();
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let status: 'connecting' | 'open' | 'closed' = 'connecting';
let started = false;

/**
 * The server broadcasts every write back to its author. Local writes already apply
 * optimistically, so a slow echo would overwrite text typed after that write (fast
 * typing lost characters). Remember what we sent and ignore exactly those echoes.
 */
const sentValues = new Map<string, string[]>();
/** Latest unsent value per document; rapid edits are coalesced instead of one WS write per keystroke. */
const pendingSends = new Map<string, { ns: string; id: string; value: unknown; timer: number }>();
const lastSendAt = new Map<string, number>();
const SEND_INTERVAL_MS = 180;

const docKey = (ns: string, id: string) => `${ns}\u0000${id}`;

function emit(ns?: string) {
  if (ns) snapshots.delete(ns); else snapshots.clear();
  listeners.forEach(listener => listener());
}
function apply(ns: string, id: string, value: unknown | undefined) {
  let docs = state.get(ns);
  if (!docs) state.set(ns, docs = new Map());
  if (value === undefined) docs.delete(id); else docs.set(id, value);
}
function connect() {
  const ws = new WebSocket(gameSocketUrl());
  socket = ws;
  status = 'connecting';
  emit();
  ws.onclose = () => {
    if (socket !== ws) return;
    status = 'closed';
    sentValues.clear();
    lastSendAt.clear();
    emit();
    setTimeout(() => { if (socket === ws) connect(); }, 1500);
  };
  ws.onmessage = (event: MessageEvent<string>) => {
    if (socket !== ws) return;
    let m: { type?: string; ns?: string; id?: string; value?: unknown; docs?: { ns: string; id: string; value: unknown }[]; message?: string };
    try { m = JSON.parse(event.data); } catch { return; }
    if (m.type === 'docs:snapshot' && m.docs) {
      state.clear();
      for (const d of m.docs) apply(d.ns, d.id, d.value);
      sentValues.clear();
      status = 'open';
      // Re-apply edits typed while disconnected: the snapshot predates them. They go out below.
      for (const [key, pending] of [...pendingSends]) {
        apply(pending.ns, pending.id, pending.value);
        transmit(key, pending);
      }
      emit();
    } else if (m.type === 'doc:set' && m.ns && m.id) {
      if (isOwnEcho(m.ns, m.id, m.value)) return;
      apply(m.ns, m.id, m.value); emit(m.ns);
    } else if (m.type === 'doc:delete' && m.ns && m.id) {
      apply(m.ns, m.id, undefined); emit(m.ns);
    } else if (m.type === 'error') reportSyncError(m.message ?? 'Change rejected by the server');
  };
}
function subscribe(listener: Listener) {
  if (!started) { started = true; connect(); }
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
function send(message: unknown) {
  if (status !== 'open' || socket?.readyState !== WebSocket.OPEN) {
    reportSyncError('No connection: the change was not saved.');
    return;
  }
  socket.send(JSON.stringify(message));
}
function rememberSent(ns: string, id: string, value: unknown) {
  const key = docKey(ns, id);
  const queue = sentValues.get(key) ?? [];
  queue.push(JSON.stringify(value));
  if (queue.length > 40) queue.shift();
  sentValues.set(key, queue);
}
/** True when this server echo is one of our own writes, which the local state already has. */
function isOwnEcho(ns: string, id: string, value: unknown): boolean {
  const key = docKey(ns, id);
  const queue = sentValues.get(key);
  if (!queue?.length) return false;
  const index = queue.indexOf(JSON.stringify(value));
  if (index === -1) return false;
  queue.splice(index, 1);
  if (!queue.length) sentValues.delete(key);
  return true;
}
function clearPendingSend(key: string) {
  const pending = pendingSends.get(key);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingSends.delete(key);
}
function transmit(key: string, pending: { ns: string; id: string; value: unknown }) {
  // While disconnected the value stays queued and is re-sent after the reconnect snapshot.
  if (status !== 'open' || socket?.readyState !== WebSocket.OPEN) return;
  clearPendingSend(key);
  lastSendAt.set(key, Date.now());
  rememberSent(pending.ns, pending.id, pending.value);
  send({ type: 'doc:set', ns: pending.ns, id: pending.id, value: pending.value });
}
/**
 * Coalesce rapid writes to the same document (typing) while still streaming continuous
 * changes (dragging a token) at a steady rate instead of once per keystroke/move event.
 */
function queueSend(ns: string, id: string, value: unknown) {
  const key = docKey(ns, id);
  const elapsed = Date.now() - (lastSendAt.get(key) ?? 0);
  clearPendingSend(key);
  if (elapsed >= SEND_INTERVAL_MS) { transmit(key, { ns, id, value }); return; }
  const timer = window.setTimeout(() => transmit(key, { ns, id, value }), SEND_INTERVAL_MS - elapsed);
  pendingSends.set(key, { ns, id, value, timer });
}
function flushPendingSends() {
  for (const [key, pending] of [...pendingSends]) transmit(key, pending);
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPendingSends);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPendingSends(); });
}
export function setDoc<T>(ns: string, id: string, value: T) {
  // Optimistic local apply: don't make the UI wait for the server echo (it made every click feel laggy).
  if (status === 'open' && socket?.readyState === WebSocket.OPEN) { apply(ns, id, value); emit(ns); }
  if (status !== 'open' || socket?.readyState !== WebSocket.OPEN) { reportSyncError('No connection: the change was not saved.'); return; }
  queueSend(ns, id, value);
}
export function removeDoc(ns: string, id: string) { clearPendingSend(docKey(ns, id)); send({ type: 'doc:delete', ns, id }); }
export function addFear(delta: number) { send({ type: 'fear:add', delta }); }
export function useDocs<T>(ns: string) {
  const items = useSyncExternalStore(subscribe, () => {
    let snap = snapshots.get(ns);
    if (!snap) { snap = Object.fromEntries(state.get(ns) ?? []); snapshots.set(ns, snap); }
    return snap;
  }) as Record<string, T>;
  const set = useCallback((id: string, value: T) => setDoc(ns, id, value), [ns]);
  const remove = useCallback((id: string) => removeDoc(ns, id), [ns]);
  return useMemo(() => ({ items, set, remove }), [items, set, remove]);
}
export function useDoc<T>(ns: string, id: string) {
  const { items, set, remove } = useDocs<T>(ns);
  return [items[id], (value: T) => set(id, value), () => remove(id)] as const;
}
export function useSyncStatus() { return useSyncExternalStore(subscribe, () => status); }
export async function uploadAsset(file: File): Promise<string> {
  const body = new FormData(); body.append('file', file);
  const res = await fetch(`/api/campaigns/${encodeURIComponent(getActiveCampaign().id)}/assets`, { method: 'POST', body });
  if (!res.ok) throw new Error(`Upload falhou: ${res.status}`);
  return ((await res.json()) as { url: string }).url;
}
