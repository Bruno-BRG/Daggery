import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { type AiAdventure, type AiBudget, type AiChat, type AiConnection, type AiJournalEntry, type AiJournalPage, type AiMessage, type AiModel, type AiProvider, type AiState, type AiTurnKind } from '@daggery/shared';
import type { Sheet } from '@daggery/shared/daggerheart/types';
import { armorScore, damageNotation, hpMax, stressMax, weaponForSlot } from '@daggery/shared/daggerheart';
import { api } from '../../api';
import { getActiveCampaign } from '../../campaign-context';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { useDocs } from '../../sync/store';
import { useMediaQuery } from '../../useMediaQuery';
import './ai.css';

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Could not complete the request.';
const navigate = (page: string) => window.dispatchEvent(new CustomEvent('daggery:navigate', { detail: page }));
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const tokens = (count: number) => count >= 1000000 ? `${(count / 1000000).toFixed(1).replace(/\.0$/, '')}M` : `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
const timeOf = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const stampOf = (value: string) => new Date(value).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
const KIND_LABEL: Record<AiJournalEntry['kind'], string> = { event: 'Event', note: 'Note', chapter: 'Chapter' };
const RUN_TEXT: Record<AiTurnKind, string> = { turn: 'Your GM is taking a turn…', compact: 'Your GM is saving the story so far…', end: 'Your GM is writing the final chapter…', pause: 'Your GM is saving where play stopped…' };
const THINKING_TEXT: Record<AiTurnKind, string> = { turn: 'The GM is preparing the next moment', compact: 'The GM is saving the story so far', end: 'The GM is writing the final chapter', pause: 'The GM is saving where play stopped' };
const BUDGETS: AiBudget[] = ['lean', 'balanced', 'rich', 'maximum'];
const BUDGET_LABEL: Record<AiBudget, string> = { lean: 'Lean', balanced: 'Balanced', rich: 'Rich', maximum: 'Maximum' };
const ENDED_NOTE = 'This session has ended. Start a new session to keep playing.';

/** Union of messages by id. Later groups replace earlier copies, and the result runs oldest first. */
function mergeMessages(...groups: AiMessage[][]): AiMessage[] {
  const byId = new Map<string, AiMessage>();
  for (const group of groups) for (const item of group) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Latest server response for one session, plus every message seen so far, so older pages join the newer ones. */
interface Feed {
  chatId: string | null;
  data: AiAdventure;
  messages: AiMessage[];
  /** Cursor for the page before \`messages\`. Null when nothing older is left. */
  cursor: string | null;
  /** True after an older page loads. Polls then keep the cursor from that page. */
  older: boolean;
}

export default function Adventure({ author: _author }: { author: string }) {
  const campaign = getActiveCampaign(), base = `/api/campaigns/${encodeURIComponent(campaign.id)}/ai`;
  const wide = useMediaQuery('(min-width: 1050px)');
  const [feed, setFeed] = useState<Feed | null>(null), [chatId, setChatId] = useState<string | null>(null);
  const [error, setError] = useState(''), [loadError, setLoadError] = useState('');
  const [connectionOpen, setConnectionOpen] = useState(false), [setupOpen, setSetupOpen] = useState(false), [sessionsOpen, setSessionsOpen] = useState(false);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [olderBusy, setOlderBusy] = useState(false);
  const [recent, setRecent] = useState<AiJournalEntry[] | null>(null), [recentError, setRecentError] = useState('');
  const chatRef = useRef<string | null>(null), latest = useRef(0), follow = useRef(true), prepend = useRef<number | null>(null);
  const transcript = useRef<HTMLDivElement>(null), end = useRef<HTMLDivElement>(null);
  const { items: sheets } = useDocs<Sheet>('sheets');
  const { items: combat } = useDocs<{ value?: number }>('combat');

  const data = feed?.data ?? null;
  const run = data?.run ?? null;
  const running = run?.status === 'running';
  const runHere = run && run.chatId === chatId ? run : null;
  const sameChat = feed !== null && feed.chatId === chatId;
  const messages = feed !== null && sameChat ? feed.messages : [];
  const chats = data?.chats ?? [];
  const selected = chats.find(item => item.id === chatId) ?? null;
  const ended = selected?.status === 'ended';
  const canWrite = chatId !== null && !ended && data !== null && data.ready && data.enabled;
  const locked = busy || running;
  const runKey = run ? `${run.id}:${run.status}` : '';
  const heroes = Object.values(sheets);

  const load = useCallback(async (requested: string | null): Promise<AiAdventure> => {
    const ticket = ++latest.current;
    const value = await api<AiAdventure>(requested ? `${base}?chat=${encodeURIComponent(requested)}` : base);
    if (ticket !== latest.current) return value;
    const known = requested !== null && value.chats.some(item => item.id === requested);
    const chat = known ? requested : value.activeChatId;
    if (!known) {
      chatRef.current = chat;
      setChatId(chat);
    }
    setFeed(previous => {
      const kept = previous !== null && previous.chatId === chat ? previous : null;
      return {
        chatId: chat,
        data: value,
        messages: mergeMessages(kept?.messages ?? [], value.messages),
        cursor: kept?.older ? kept.cursor : value.earlierCursor,
        older: kept?.older ?? false,
      };
    });
    return value;
  }, [base]);

  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let delay = 4000;
      try {
        const value = await load(chatRef.current);
        if (!active) return;
        setLoadError('');
        delay = value.run?.status === 'running' ? 1000 : 4000;
      } catch (failure) {
        if (!active) return;
        setLoadError(errorText(failure));
        delay = 6000;
      }
      timer = setTimeout(tick, delay);
    };
    void tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    let active = true;
    api<AiJournalPage>(`${base}/journal?kind=all`)
      .then(page => {
        if (active) {
          setRecent(page.entries.slice(0, 6));
          setRecentError('');
        }
      })
      .catch(failure => {
        if (active) setRecentError(errorText(failure));
      });
    return () => {
      active = false;
    };
  }, [base, runKey]);

  useLayoutEffect(() => {
    const node = transcript.current;
    if (prepend.current !== null) {
      if (node) node.scrollTop += node.scrollHeight - prepend.current;
      prepend.current = null;
      return;
    }
    if (follow.current) end.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [messages.length, running]);

  function choose(id: string) {
    chatRef.current = id;
    setChatId(id);
    follow.current = true;
    void load(id).catch(failure => setError(errorText(failure)));
  }
  async function perform(path: string, body?: unknown, method = 'POST') {
    setBusy(true);
    setError('');
    try {
      await api(`${base}${path}`, method, body);
      await load(chatRef.current);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  async function submitTurn(text: string) {
    const target = chatRef.current;
    if (!target) return false;
    setBusy(true);
    setError('');
    try {
      await api(`${base}/turn`, 'POST', { chatId: target, requestId: crypto.randomUUID(), message: text });
      follow.current = true;
      await load(chatRef.current);
      return true;
    } catch (failure) {
      setError(errorText(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!canWrite || locked || !message.trim()) return;
    const draft = message;
    if (await submitTurn(draft)) setMessage(current => (current === draft ? '' : current));
  }
  async function begin() {
    const target = chatRef.current;
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      await api(`${base}/begin`, 'POST', { chatId: target });
      follow.current = true;
      await load(chatRef.current);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  async function createSession() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ chat: AiChat }>(`${base}/chats`, 'POST', {});
      choose(result.chat.id);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  async function renameChat(chat: AiChat, title: string) {
    setBusy(true);
    setError('');
    try {
      await api(`${base}/chats/${encodeURIComponent(chat.id)}`, 'PATCH', { title });
      await load(chatRef.current);
      return true;
    } catch (failure) {
      setError(errorText(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function endChat(chat: AiChat) {
    if (!window.confirm(`End "${chat.title}"? Your GM writes a final chapter, and the session becomes read only.`)) return;
    void perform('/end', { chatId: chat.id });
  }
  function compactChat(chat: AiChat) {
    void perform('/compact', { chatId: chat.id });
  }
  async function deleteChat(chat: AiChat) {
    if (!window.confirm(`Delete "${chat.title}"? Its messages are removed. Journal entries stay.`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`${base}/chats/${encodeURIComponent(chat.id)}`, 'DELETE');
      const next = chats.filter(item => item.id !== chat.id).sort((a, b) => b.ordinal - a.ordinal)[0];
      if (next) choose(next.id);
      else {
        chatRef.current = null;
        setChatId(null);
        await load(null);
      }
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  async function loadOlder() {
    if (!feed || !chatId || !feed.cursor) return;
    const target = chatId, cursor = feed.cursor, known = new Set(feed.messages.map(item => item.id)), before = transcript.current?.scrollHeight ?? 0;
    setOlderBusy(true);
    setError('');
    try {
      const page = await api<AiAdventure>(`${base}?chat=${encodeURIComponent(target)}&before=${encodeURIComponent(cursor)}`);
      if (chatRef.current !== target) return;
      if (page.messages.some(item => !known.has(item.id))) prepend.current = before;
      setFeed(previous => previous && previous.chatId === target ? { ...previous, messages: mergeMessages(page.messages, previous.messages), cursor: page.earlierCursor, older: true } : previous);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setOlderBusy(false);
    }
  }

  if (!feed || !data) return <div className="ai-loading" role="status">{loadError || 'Opening your adventure…'}</div>;
  const hero = sheets[data.setup.heroId];
  const memory = data.memoryStatus;
  const ordinalLabel = selected && selected.title !== `Session ${selected.ordinal}` ? `Session ${selected.ordinal}` : '';
  const memoryLine = [selected?.title, ordinalLabel, plural(memory.chapters, 'chapter'), `context ${tokens(memory.contextTokens)} of ${tokens(memory.budgetTokens)}`].filter(Boolean).join(' · ');
  const statusText = running && run ? RUN_TEXT[run.kind] : ended ? 'This session has ended and is read only.' : !data.ready ? 'Connect your provider, bring a hero, and step into the unknown.' : data.enabled ? 'The next move is yours.' : 'Your GM is paused.';
  const composerNote = chatId === null ? 'Start a session to play.' : ended ? ENDED_NOTE : running ? 'Waiting for the GM' : 'Your choices shape the story. Ctrl + Enter to send.';
  const showWelcome = chatId === null || (sameChat && messages.length === 0);
  const welcome = chatId === null ? <div className="ai-welcome">
      <span className="ai-chapter">No session yet</span>
      <Icon name="compass" />
      <h2>Your story is waiting for a session.</h2>
      <p>Start a session when you are ready. Your GM only starts once you press Begin the adventure.</p>
      {data.isGm ? <button type="button" className="daggery-primary" disabled={locked} onClick={() => void createSession()}>Start a session <Icon name="arrow" /></button> : <p>The campaign owner starts the next session.</p>}
    </div> : ended ? <div className="ai-welcome">
      <span className="ai-chapter">Session ended</span>
      <Icon name="lock" />
      <h2>This session is closed.</h2>
      <p>Its record stays readable here and in the journal.</p>
    </div> : <div className="ai-welcome">
      <span className="ai-chapter">{selected && selected.ordinal > 1 ? `Session ${selected.ordinal}` : 'Chapter one'}</span>
      <Icon name="compass" />
      <h2>Every adventure begins<br />with a little curiosity.</h2>
      <p>Your GM describes the world and runs its tools. You decide what your hero does. Dice, rewards, and changes stay with your campaign.</p>
      {data.isGm ? !data.connection ? <button type="button" className="daggery-primary" onClick={() => setConnectionOpen(true)}>Connect OpenCode <Icon name="arrow" /></button> : <button type="button" className="daggery-primary" onClick={() => setSetupOpen(true)}>{data.ready ? 'Review adventure setup' : 'Set up your adventure'} <Icon name="arrow" /></button> : <p>The campaign owner is preparing the GM connection.</p>}
      {canWrite && <button type="button" className="daggery-roll-toggle" disabled={locked} onClick={() => void begin()}>Begin the adventure</button>}
      <small>When the journal has entries, your GM recaps the story so far first.</small>
      <small>Your provider bills model usage to your account.</small>
    </div>;
  const toolbar = <div className="ai-toolbar">
    {!wide && <button type="button" className="daggery-roll-toggle" aria-haspopup="dialog" onClick={() => setSessionsOpen(true)}><Icon name="book" />Sessions</button>}
    {data.isGm && <button type="button" className="daggery-roll-toggle" onClick={() => setConnectionOpen(true)}><Icon name="settings" />{data.connection ? 'GM connection' : 'Connect OpenCode'}</button>}
    {data.isGm && data.ready && <button type="button" className="daggery-roll-toggle" disabled={busy} onClick={() => void perform('/enabled', { enabled: !data.enabled }, 'PUT')}>{data.enabled ? 'Pause GM' : 'Resume GM'}</button>}
  </div>;
  const sessions = (heading: boolean, picked?: () => void) => <SessionPanel chats={chats} selectedId={chatId} isGm={data.isGm} locked={locked} heading={heading} onPick={id => { choose(id); picked?.(); }} onCreate={() => void createSession()} onRename={renameChat} onCompact={compactChat} onEnd={endChat} onDelete={chat => void deleteChat(chat)} />;

  return <div className="ai-adventure">
    <header className="ai-heading">
      <div>
        <p className="ai-eyebrow">Daggerheart · AI Game Master</p>
        <h1>{messages.length === 0 ? 'A story waiting to happen.' : 'Your adventure'}</h1>
        <p>{statusText}</p>
        <p className="ai-memory-line">{memoryLine}</p>
      </div>
      {toolbar}
    </header>
    {error ? <p className="ai-error" role="alert">{error}</p> : loadError ? <p className="ai-error" role="alert">{loadError}</p> : null}
    <div className="ai-layout">
      {wide && <aside className="ai-rail" aria-label="Sessions">{sessions(true)}</aside>}
      <section className="ai-story" aria-label="Adventure conversation">
        {showWelcome ? welcome : !sameChat && <p className="ai-opening" role="status">Opening session…</p>}
        <div className="ai-transcript" role="log" aria-label="Adventure messages" ref={transcript} onScroll={event => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60; }}>
          {sameChat && feed.cursor && <div className="ai-earlier"><button type="button" className="daggery-roll-toggle" disabled={olderBusy} onClick={() => void loadOlder()}>{olderBusy ? 'Loading earlier messages…' : 'Load earlier messages'}</button></div>}
          {messages.map(entry => entry.role === 'notice' ? <p key={entry.id} className="ai-notice"><span>{entry.text}</span></p> : <article key={entry.id} className={`ai-message ai-message-${entry.role}`}>
            <header><strong>{entry.role === 'gm' ? 'Game Master' : entry.role === 'player' ? 'Player' : 'At the dice'}</strong><time dateTime={entry.at}>{timeOf(entry.at)}</time></header>
            <Narration text={entry.text} />
            {entry.interaction && !entry.interaction.resolved && <ActionCard message={entry} sheet={sheets[entry.interaction.heroId ?? '']} disabled={locked || !canWrite} resolve={value => perform(`/messages/${encodeURIComponent(entry.id)}/resolve`, value)} />}
            {entry.interaction?.resolved && <small className="ai-resolved">Resolved</small>}
          </article>)}
          {runHere?.status === 'running' && <div className="ai-thinking" role="status"><span />{THINKING_TEXT[runHere.kind]}<small>{runHere.steps} model {runHere.steps === 1 ? 'request' : 'requests'}</small><button type="button" disabled={busy} onClick={() => void perform('/stop')}>Stop</button></div>}
          {runHere?.status === 'failed' && <div className="ai-error" role="alert"><p>{runHere.error}</p><button type="button" className="daggery-roll-toggle" disabled={busy || !canWrite} onClick={() => void perform('/retry', { turnId: runHere.id })}>Retry saved turn</button><small>Completed game actions are retained.</small></div>}
          {runHere?.status === 'cancelled' && <p className="ai-muted">GM turn stopped. Completed actions are saved. Send a message to continue.</p>}
          <div ref={end} />
        </div>
        <form className="ai-composer" onSubmit={send}>
          <label htmlFor="ai-message">What do you do?</label>
          <textarea id="ai-message" rows={3} maxLength={4000} value={message} disabled={!canWrite} placeholder={ended ? ENDED_NOTE : 'Describe your action, speak to someone, or ask your GM…'} onChange={event => setMessage(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <div><small>{composerNote}</small><button className="daggery-primary" disabled={!canWrite || locked || !message.trim()}><Icon name="arrow" />Send</button></div>
        </form>
      </section>
      <aside className="ai-ledger" aria-label="Adventure details">
        <section>
          <p className="ai-eyebrow">At your table</p>
          <h2>{hero?.name ?? 'Your party'}</h2>
          {heroes.length === 0 && <p>No heroes yet. Adventure setup can create one for you.</p>}
          {heroes.map(sheet => <div className="ai-hero" key={sheet.id}><strong>{sheet.name}</strong><small>Level {sheet.level} · {sheet.classId}</small><dl><div><dt>HP marked</dt><dd>{sheet.hpMarked}/{hpMax(sheet)}</dd></div><div><dt>Stress</dt><dd>{sheet.stressMarked}/{stressMax(sheet)}</dd></div><div><dt>Hope</dt><dd>{sheet.hope}/6</dd></div><div><dt>Armor used</dt><dd>{sheet.armorSlotsMarked}/{armorScore(sheet)}</dd></div></dl></div>)}
          <button type="button" className="ai-link" onClick={() => navigate('sheets')}>Open character sheets <Icon name="arrow" /></button>
          <div className="ai-fear"><span>GM Fear</span><strong>{combat.fear?.value ?? 0} / 12</strong></div>
        </section>
        <section>
          <h2>Your campaign</h2>
          <button type="button" className="ai-link" onClick={() => navigate('map')}>Game table <Icon name="map" /></button>
          <button type="button" className="ai-link" onClick={() => navigate('notes')}>Session notes <Icon name="note" /></button>
          {campaign.configuration.rulesetId === 'solo' && data.isGm && <button type="button" className="ai-link" onClick={() => navigate('solo')}>Solo oracles & themes <Icon name="spark" /></button>}
          {data.isGm && <button type="button" className="ai-link" onClick={() => navigate('gm')}>GM preparations <Icon name="compass" /></button>}
        </section>
        <section>
          <h2>Latest journal entries</h2>
          {recent === null ? <p>{recentError || 'Loading journal…'}</p> : recent.length === 0 ? <p>Entries appear here as the adventure unfolds.</p> : <ol className="ai-journal-preview">{recent.map(entry => <li key={entry.id}><span className="ai-kind">{KIND_LABEL[entry.kind]}</span><strong>{entry.title}</strong><time dateTime={entry.createdAt}>{stampOf(entry.createdAt)}</time></li>)}</ol>}
          <button type="button" className="ai-link" onClick={() => navigate('journal')}>Open journal <Icon name="arrow" /></button>
        </section>
        {data.isGm && <section>
          <details className="ai-memory-panel">
            <summary>GM memory</summary>
            <MemoryView session={data} />
            <Memory key={data.memory} value={data.memory} disabled={locked} save={value => perform('/memory', { memory: value }, 'PUT')} />
          </details>
          <button type="button" className="ai-link" disabled={running} onClick={() => setSetupOpen(true)}>Adventure setup <Icon name="settings" /></button>
        </section>}
      </aside>
    </div>
    {connectionOpen && <Connection connection={data.connection} onClose={() => setConnectionOpen(false)} onSaved={async () => { const next = await load(chatRef.current); setConnectionOpen(false); if (next.connection && !next.ready) setSetupOpen(true); }} />}
    {setupOpen && <Setup base={base} session={data} heroes={heroes} onClose={() => setSetupOpen(false)} onSaved={async () => { await load(chatRef.current); setSetupOpen(false); }} />}
    {!wide && <Dialog open={sessionsOpen} onClose={() => setSessionsOpen(false)} title="Sessions">{sessions(false, () => setSessionsOpen(false))}</Dialog>}
  </div>;
}

interface SessionPanelProps {
  chats: AiChat[];
  selectedId: string | null;
  isGm: boolean;
  locked: boolean;
  heading: boolean;
  onPick: (id: string) => void;
  onCreate: () => void;
  onRename: (chat: AiChat, title: string) => Promise<boolean>;
  onCompact: (chat: AiChat) => void;
  onEnd: (chat: AiChat) => void;
  onDelete: (chat: AiChat) => void;
}

function SessionPanel({ chats, selectedId, isGm, locked, heading, onPick, onCreate, onRename, onCompact, onEnd, onDelete }: SessionPanelProps) {
  const ordered = [...chats].sort((a, b) => b.ordinal - a.ordinal);
  const current = chats.find(chat => chat.id === selectedId);
  return <div className="ai-sessions">
    <div className="ai-sessions-head">
      {heading && <h2>Sessions</h2>}
      {isGm && <button type="button" className="daggery-roll-toggle" disabled={locked} onClick={onCreate}><Icon name="plus" />New session</button>}
    </div>
    {ordered.length === 0 ? <p>No sessions yet.</p> : <ul className="ai-session-list">
      {ordered.map(chat => <li key={chat.id}>
        <button type="button" className="ai-session" aria-current={chat.id === selectedId ? 'true' : undefined} onClick={() => onPick(chat.id)}>
          <span className="ai-session-title">{chat.title}{chat.status === 'ended' && <span className="ai-badge">Ended</span>}</span>
          <small>Session {chat.ordinal} · {plural(chat.messageCount, 'message')} · {stampOf(chat.updatedAt)}</small>
        </button>
      </li>)}
    </ul>}
    {isGm && current && <SessionActions key={current.id} chat={current} locked={locked} onRename={onRename} onCompact={onCompact} onEnd={onEnd} onDelete={onDelete} />}
  </div>;
}

function SessionActions({ chat, locked, onRename, onCompact, onEnd, onDelete }: { chat: AiChat; locked: boolean; onRename: (chat: AiChat, title: string) => Promise<boolean>; onCompact: (chat: AiChat) => void; onEnd: (chat: AiChat) => void; onDelete: (chat: AiChat) => void }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(chat.title);
  const open = chat.status === 'open';
  async function save(event: FormEvent) {
    event.preventDefault();
    const title = draft.trim();
    if (title && await onRename(chat, title)) setEditing(false);
  }
  return <div className="ai-session-actions">
    {editing ? <form className="ai-rename" onSubmit={save}>
      <label>Session title<input value={draft} maxLength={120} autoFocus onChange={event => setDraft(event.target.value)} /></label>
      <div><button className="daggery-primary" disabled={locked || !draft.trim()}>Save title</button><button type="button" className="ai-link" onClick={() => setEditing(false)}>Cancel</button></div>
    </form> : <button type="button" className="ai-link" disabled={locked} onClick={() => { setDraft(chat.title); setEditing(true); }}>Rename session <Icon name="custom" /></button>}
    {open && <button type="button" className="ai-link" disabled={locked} onClick={() => onCompact(chat)}>Compact now <Icon name="scroll" /></button>}
    <button type="button" className="ai-link" disabled={locked || !open} onClick={() => onEnd(chat)}>End session <Icon name="lock" /></button>
    <button type="button" className="ai-link ai-danger" disabled={locked} onClick={() => onDelete(chat)}>Delete session <Icon name="trash" /></button>
  </div>;
}

function MemoryView({ session }: { session: AiAdventure }) {
  const state: AiState | null = session.state;
  return <div className="ai-memory-view">
    <div><h3>Campaign digest</h3>{session.digest ? <p>{session.digest}</p> : <p>Nothing recorded yet.</p>}</div>
    <div><h3>This session</h3>{session.chatSummary ? <p>{session.chatSummary}</p> : <p>No summary yet.</p>}</div>
    {state ? <>
      <dl className="ai-scene">
        <div><dt>Location</dt><dd>{state.location || 'Not set'}</dd></div>
        <div><dt>Time of day</dt><dd>{state.timeOfDay || 'Not set'}</dd></div>
        <div><dt>Objective</dt><dd>{state.objective || 'Not set'}</dd></div>
      </dl>
      <MemoryList title="Threads" count={state.threads.length} empty="No threads yet.">{state.threads.map(thread => <li key={thread.id}><strong>{thread.title}</strong> <span className="ai-badge">{thread.status}</span>{thread.note && <small>{thread.note}</small>}</li>)}</MemoryList>
      <MemoryList title="NPCs" count={state.npcs.length} empty="No one met yet.">{state.npcs.map(npc => <li key={npc.id}><strong>{npc.name}</strong>{npc.role && <span>, {npc.role}</span>}<small>{[npc.attitude, npc.lastSeen ? `last seen ${npc.lastSeen}` : ''].filter(Boolean).join(' · ')}</small></li>)}</MemoryList>
      <MemoryList title="Promises" count={state.promises.length} empty="No promises yet.">{state.promises.map(promise => <li key={promise.id}>{promise.text}</li>)}</MemoryList>
      <MemoryList title="Facts" count={state.facts.length} empty="No facts yet.">{state.facts.map((fact, index) => <li key={index}>{fact}</li>)}</MemoryList>
    </> : <p>No scene state yet.</p>}
  </div>;
}

function MemoryList({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  return <div><h3>{title}</h3>{count > 0 ? <ul>{children}</ul> : <p>{empty}</p>}</div>;
}

function Narration({ text }: { text: string }) {
  return <div className="ai-prose">{text.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part)}</p>)}</div>;
}
/** First NdM term of a damage notation, used to size the physical damage inputs. */
function diceShape(notation: string): { count: number; sides: number } {
  const match = /(\d*)d(\d+)/i.exec(notation);
  return match ? { count: Math.max(1, Number(match[1] || 1)), sides: Number(match[2]) } : { count: 0, sides: 0 };
}
const validDie = (value: string, sides: number) => /^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= sides;

function ActionCard({ message, sheet, disabled, resolve }: { message: AiMessage; sheet?: Sheet; disabled: boolean; resolve: (value: unknown) => Promise<void> }) {
  const card = message.interaction!;
  const [experienceId, setExperience] = useState(''), [advantage, setAdvantage] = useState('normal'), [useArmor, setArmor] = useState(false);
  const [focus, setFocus] = useState(false), [prayerIndex, setPrayerIndex] = useState('');
  const [mode, setMode] = useState<'digital' | 'physical'>('digital');
  const [hopeDie, setHopeDie] = useState(''), [fearDie, setFearDie] = useState(''), [advantageDie, setAdvantageDie] = useState(''), [damageDice, setDamageDice] = useState('');
  const weapon = card.kind === 'roll' && card.enemyId && sheet ? weaponForSlot(sheet, 'primary') : undefined;
  const shape = diceShape(weapon && sheet ? damageNotation(weapon.damage, sheet.proficiency) : '');
  const advantageNeeded = advantage === 'advantage' || advantage === 'disadvantage';
  const prayerDice = sheet?.resources?.prayerDice ?? [];
  const prayerSpend = prayerIndex === '' ? {} : { prayerDie: { index: Number(prayerIndex) } };
  const focusSpend = card.kind === 'roll' && card.enemyId && focus ? { focus: true } : {};
  const damageFaces = damageDice.split(',').map(part => part.trim()).filter(Boolean);
  const damageValid = !card.enemyId || damageFaces.length === shape.count && damageFaces.every(face => validDie(face, shape.sides));
  const physicalValid = validDie(hopeDie, 12) && validDie(fearDie, 12) && (!advantageNeeded || validDie(advantageDie, 6)) && damageValid;
  return <div className="ai-action-card"><strong><Icon name={card.kind === 'roll' ? 'dice' : card.kind === 'damage' ? 'shield' : 'compass'} />{card.kind === 'roll' ? `${sheet?.name ?? 'Hero'} · ${card.trait} · Difficulty ${card.difficulty}` : card.kind === 'damage' ? `${sheet?.name ?? 'Hero'} · ${card.damage} incoming damage` : 'A few possibilities'}</strong>
    {card.kind === 'choices' ? <div className="ai-choices">{card.choices?.map(choice => <button key={choice} type="button" disabled={disabled} onClick={() => void resolve({ choice })}>{choice}<Icon name="arrow" /></button>)}</div> : card.kind === 'roll' ? <>
      <label>Advantage<select aria-label="Advantage" value={advantage} disabled={disabled} onChange={event => setAdvantage(event.target.value)}><option value="normal">Normal roll</option><option value="advantage">Advantage +d6</option><option value="disadvantage">Disadvantage −d6</option></select></label>
      <label>Experience · costs 1 Hope<select aria-label="Experience" value={experienceId} disabled={disabled} onChange={event => setExperience(event.target.value)}><option value="">No Experience</option>{sheet?.experiences.map(experience => <option key={experience.id} value={experience.id} disabled={(sheet?.hope ?? 0) < 1}>{experience.name} +{experience.modifier}</option>)}</select></label>
      {sheet?.classId === 'ranger' && card.enemyId && <label className="ai-checkbox"><input type="checkbox" checked={focus} disabled={disabled || (sheet?.hope ?? 0) < 1} onChange={event => setFocus(event.target.checked)} />Ranger’s Focus · mark target, costs 1 Hope</label>}
      {prayerDice.length > 0 && <label>Spend a Prayer Die<select aria-label="Prayer Die" value={prayerIndex} disabled={disabled} onChange={event => setPrayerIndex(event.target.value)}><option value="">Keep all dice</option>{prayerDice.map((value, index) => <option key={index} value={index}>d4: {value} (die {index + 1})</option>)}</select></label>}
      <div className="ai-dice-mode" role="group" aria-label="Dice source">
        <button type="button" aria-pressed={mode === 'digital'} disabled={disabled} onClick={() => setMode('digital')}>Digital dice</button>
        <button type="button" aria-pressed={mode === 'physical'} disabled={disabled} onClick={() => setMode('physical')}>My physical dice</button>
      </div>
      {mode === 'physical' ? <>
        <div className="ai-dice-fields">
          <label>Hope d12<input aria-label="Hope d12" type="number" min={1} max={12} inputMode="numeric" value={hopeDie} disabled={disabled} onChange={event => setHopeDie(event.target.value)} /></label>
          <label>Fear d12<input aria-label="Fear d12" type="number" min={1} max={12} inputMode="numeric" value={fearDie} disabled={disabled} onChange={event => setFearDie(event.target.value)} /></label>
          {advantageNeeded && <label>{advantage === 'advantage' ? 'Advantage' : 'Disadvantage'} d6<input aria-label="Advantage d6" type="number" min={1} max={6} inputMode="numeric" value={advantageDie} disabled={disabled} onChange={event => setAdvantageDie(event.target.value)} /></label>}
          {card.enemyId && shape.count > 0 && <label>Damage {shape.count}d{shape.sides}<input aria-label="Damage dice" placeholder={`${shape.count} ${shape.sides}-sided dice, comma separated`} value={damageDice} disabled={disabled} onChange={event => setDamageDice(event.target.value)} /></label>}
        </div>
        <button className="daggery-primary" disabled={disabled || !sheet || !physicalValid} onClick={() => void resolve({ experienceId, advantage, ...focusSpend, ...prayerSpend, dice: { hope: Number(hopeDie), fear: Number(fearDie), ...(advantageNeeded ? { advantageDie: Number(advantageDie) } : {}) }, ...(card.enemyId ? { damageDice: damageFaces.map(Number) } : {}) })}>Roll with physical dice</button>
      </> : <button className="daggery-primary" disabled={disabled || !sheet} onClick={() => void resolve({ experienceId, advantage, ...focusSpend, ...prayerSpend })}>Roll Duality dice</button>}
    </> : <>{!card.direct && <label className="ai-checkbox"><input type="checkbox" checked={useArmor} disabled={disabled || !sheet || sheet.armorSlotsMarked >= armorScore(sheet)} onChange={event => setArmor(event.target.checked)} />Use 1 Armor Slot to reduce severity</label>}{prayerDice.length > 0 && <label>Spend a Prayer Die<select aria-label="Prayer Die" value={prayerIndex} disabled={disabled} onChange={event => setPrayerIndex(event.target.value)}><option value="">Keep all dice</option>{prayerDice.map((value, index) => <option key={index} value={index}>reduce damage by {value} (die {index + 1})</option>)}</select></label>}<button className="daggery-primary" disabled={disabled || !sheet} onClick={() => void resolve({ useArmor, ...prayerSpend })}>Apply damage</button></>}
  </div>;
}
function Memory({ value, disabled, save }: { value: string; disabled: boolean; save: (value: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  return <details><summary>GM secrets & plans</summary><label className="ai-sr-label">Private GM memory<textarea aria-label="Private GM memory" rows={6} maxLength={4000} value={draft} onChange={event => setDraft(event.target.value)} /></label><button className="daggery-roll-toggle" disabled={disabled || draft === value} onClick={() => void save(draft)}>Save memory</button></details>;
}
function Connection({ connection, onClose, onSaved }: { connection: AiConnection | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [provider, setProvider] = useState<AiProvider>(connection?.provider ?? 'opencode-go'), [key, setKey] = useState(''), [model, setModel] = useState(connection?.model ?? '');
  const reuseKey = !!connection && (connection.provider === provider ||
    [connection.provider, provider].every(value => value === 'opencode' || value === 'opencode-go'));
  const [models, setModels] = useState<AiModel[]>([]), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => { let active = true; setLoading(true); setError(''); void api<{ models: AiModel[] }>(`/api/ai/models?provider=${provider}`).then(result => { if (active) { setModels(result.models); setModel(current => result.models.some(item => item.id === current) ? current : result.models[0]?.id ?? ''); } }).catch(error => { if (active) setError(errorText(error)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [provider, reload]);
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await api('/api/ai/connection', 'PUT', { provider, model, apiKey: key }); setKey(''); await onSaved(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }
  return <Dialog open onClose={onClose} title="GM connection"><form className="ai-form" onSubmit={save}>
    <p>Choose the OpenCode plan you use. Go subscription and pay-as-you-go credits use separate connections.</p>
    <label>Provider<select aria-label="Provider" value={provider} onChange={event => { setProvider(event.target.value as AiProvider); setModels([]); setKey(''); }}>
      <option value="opencode-go">OpenCode Go · subscription</option>
      <option value="opencode">OpenCode Console / Zen · pay as you go</option>
      <option value="openrouter">OpenRouter</option>
    </select></label>
    <label>API key {reuseKey && <small>Saved: {connection!.keyHint}</small>}<input aria-label="API key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} placeholder={reuseKey ? 'Leave blank to keep your saved OpenCode key' : 'Paste your provider API key'} required={!reuseKey} maxLength={1024} /></label>
    <p className="ai-muted">{provider === 'opencode-go' ? <>Use the key from your <a href="https://opencode.ai/docs/console/go/" target="_blank" rel="noreferrer">OpenCode Go subscription</a>. Requests use Go’s model catalog and allowance. Daggery never automatically switches to the pay-as-you-go endpoint. Any Extra Usage enabled in your OpenCode account is controlled by OpenCode.</> : provider === 'opencode' ? <>Use an <a href="https://opencode.ai/docs/console/api" target="_blank" rel="noreferrer">OpenCode Console inference key</a> with credits. This option bills pay as you go and does not use your Go allowance.</> : <>Create a key in your <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">OpenRouter account</a>.</>} Your key is encrypted on the Daggery server and never sent back to the browser.</p>
    {provider === 'opencode-go' && <p className="ai-muted">OpenCode describes Go as intended for coding agents. GM requests may be restricted by the provider.</p>}
    <label>Model<select aria-label="Model" value={model} disabled={loading || !models.length} onChange={event => setModel(event.target.value)}>{loading ? <option>Loading available models…</option> : models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <small>Only models with tool calling from the selected provider are listed.</small>
    {error && <p className="ai-error" role="alert">{error}</p>}
    <div className="ai-toolbar"><button className="daggery-primary" disabled={busy || loading || !models.length}>{busy ? 'Saving…' : 'Save connection'}</button><button type="button" className="daggery-roll-toggle" disabled={busy || loading} onClick={() => setReload(value => value + 1)}>Reload models</button>{connection && <button type="button" className="ai-link" disabled={busy} onClick={async () => { setBusy(true); try { await api('/api/ai/connection', 'DELETE'); await onSaved(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }}>Remove key</button>}</div>
  </form></Dialog>;
}
function Setup({ base, session, heroes, onClose, onSaved }: { base: string; session: AiAdventure; heroes: Sheet[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [premise, setPremise] = useState(session.setup.premise), [tone, setTone] = useState(session.setup.tone), [persona, setPersona] = useState(session.setup.persona), [heroId, setHeroId] = useState(session.setup.heroId || heroes[0]?.id || 'new');
  const [budget, setBudget] = useState<AiBudget>(session.budget);
  const [name, setName] = useState('Ash'), [classId, setClassId] = useState('warrior'), [classes, setClasses] = useState<{ id: string; name: string }[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { void api<{ classes: { id: string; name: string }[] }>(`${base}/options`).then(value => setClasses(value.classes)).catch(error => setError(errorText(error))); }, [base]);
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await api(`${base}/setup`, 'PUT', { premise, tone, persona, budget, ...(heroId === 'new' ? { quickHero: { name, classId } } : { heroId }) }); await onSaved(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }
  return <Dialog open onClose={onClose} title="Adventure setup"><form className="ai-form" onSubmit={save}>
    <p>Give your GM a starting point. Leave the premise open and discover it together.</p>
    <label>Adventure premise<textarea rows={4} maxLength={3000} value={premise} onChange={event => setPremise(event.target.value)} placeholder="A missing courier, a town swallowed by mist, a debt to an old friend…" /></label>
    <label>Tone & boundaries<input maxLength={300} value={tone} onChange={event => setTone(event.target.value)} placeholder="Hopeful fantasy, mystery, no graphic violence" /></label>
    <label>GM persona & table style<textarea rows={3} maxLength={1500} value={persona} onChange={event => setPersona(event.target.value)} placeholder="Warm, wry narrator; slow-burn mystery; NPCs speak in short sentences" /></label>
    <label>Your hero<select aria-label="Your hero" value={heroId} onChange={event => setHeroId(event.target.value)}>{heroes.map(hero => <option key={hero.id} value={hero.id}>{hero.name} · {hero.classId}</option>)}<option value="new">Create a ready-to-play hero</option><option value="">Use the whole existing party</option></select></label>
    {heroId === 'new' && <><label>Hero name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label><label>Class<select aria-label="Class" value={classId} onChange={event => setClassId(event.target.value)}>{classes.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><small>Starts at level 1 with equipment and domain cards. Customize your heritage, cards, and story in Characters.</small></>}
    <label>Memory size<select value={budget} onChange={event => setBudget(event.target.value as AiBudget)}>{BUDGETS.map(item => <option key={item} value={item}>{BUDGET_LABEL[item]} · {tokens(session.budgets[item])} tokens</option>)}</select></label>
    <small>How much story and continuity the GM keeps in view each turn. Larger memory tracks more detail and costs more per turn.</small>
    {budget === 'maximum' && <small>{session.connection && session.connection.contextWindow > 0 ? 'Maximum sends up to 60 percent of your model\'s context window on each request. That is much larger than Balanced, costs more, and can take longer.' : `Daggery has not read this model's context window yet. Save the GM connection again. Until then Maximum uses ${tokens(session.budgets.maximum)} tokens.`}</small>}
    {error && <p role="alert" className="ai-error">{error}</p>}
    <button className="daggery-primary" disabled={busy || !session.connection || heroId === 'new' && !classes.length}>{busy ? 'Preparing…' : 'Save adventure setup'}</button>
  </form></Dialog>;
}
