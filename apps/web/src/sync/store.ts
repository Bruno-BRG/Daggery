import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { gameSocketUrl, getActiveCampaign, reportSyncError } from '../campaign-context';

type Listener = () => void;
const state = new Map<string, Map<string, unknown>>();
const snapshots = new Map<string, Record<string, unknown>>();
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let status: 'connecting' | 'open' | 'closed' = 'connecting';
let started = false;

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
      status = 'open';
      emit();
    } else if (m.type === 'doc:set' && m.ns && m.id) {
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
export function setDoc<T>(ns: string, id: string, value: T) {
  send({ type: 'doc:set', ns, id, value });
  // Optimistic local apply: don't make the UI wait for the server echo (it made every click feel laggy).
  if (status === 'open' && socket?.readyState === WebSocket.OPEN) { apply(ns, id, value); emit(ns); }
}
export function removeDoc(ns: string, id: string) { send({ type: 'doc:delete', ns, id }); }
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
