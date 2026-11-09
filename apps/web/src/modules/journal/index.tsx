import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AiJournalEntry, AiJournalKind, AiJournalPage } from '@daggery/shared';
import { api } from '../../api';
import { getActiveCampaign } from '../../campaign-context';
import { Icon } from '../../components/Icon';
import './journal.css';

type Filter = 'all' | AiJournalKind;
interface Draft { title: string; body: string; shared: boolean }

const FILTERS: { value: Filter; label: string }[] = [{ value: 'all', label: 'All' }, { value: 'note', label: 'Notes' }, { value: 'chapter', label: 'Chapters' }, { value: 'event', label: 'Events' }];
const KIND_LABEL: Record<AiJournalKind, string> = { event: 'Event', note: 'Note', chapter: 'Chapter' };
const EMPTY: Draft = { title: '', body: '', shared: false };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Could not complete the request.';
const stampOf = (value: string) => new Date(value).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

/** Entries with the same chat share one heading, in order of first appearance. */
function groupByChat(entries: AiJournalEntry[]) {
  const groups: { label: string; items: AiJournalEntry[] }[] = [];
  const byChat = new Map<string, { label: string; items: AiJournalEntry[] }>();
  for (const entry of entries) {
    const label = entry.chatLabel || 'Campaign';
    const key = entry.chatId ? `id:${entry.chatId}` : `label:${label}`;
    const group = byChat.get(key);
    if (group) group.items.push(entry);
    else {
      const next = { label, items: [entry] };
      byChat.set(key, next);
      groups.push(next);
    }
  }
  return groups;
}

export default function Journal({ author: _author }: { author: string }) {
  const campaign = getActiveCampaign(), base = `/api/campaigns/${encodeURIComponent(campaign.id)}/ai`, owner = campaign.role === 'gm';
  const [filter, setFilter] = useState<Filter>('all'), [query, setQuery] = useState(''), [search, setSearch] = useState('');
  const [entries, setEntries] = useState<AiJournalEntry[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [version, setVersion] = useState(0), [moreBusy, setMoreBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null), [adding, setAdding] = useState(false), [note, setNote] = useState<Draft>(EMPTY), [saving, setSaving] = useState(false);
  const scope = useRef('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ kind: filter });
    if (search) params.set('q', search);
    scope.current = `${filter}|${search}`;
    setLoading(true);
    setError('');
    api<AiJournalPage>(`${base}/journal?${params.toString()}`)
      .then(page => {
        if (active) {
          setEntries(page.entries);
          setCursor(page.nextCursor);
        }
      })
      .catch(failure => {
        if (active) setError(errorText(failure));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, filter, search, version]);

  async function loadMore() {
    if (!cursor) return;
    const current = `${filter}|${search}`;
    const params = new URLSearchParams({ kind: filter, cursor });
    if (search) params.set('q', search);
    setMoreBusy(true);
    setError('');
    try {
      const page = await api<AiJournalPage>(`${base}/journal?${params.toString()}`);
      if (scope.current !== current) return;
      setEntries(previous => [...previous, ...page.entries.filter(entry => !previous.some(item => item.id === entry.id))]);
      setCursor(page.nextCursor);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setMoreBusy(false);
    }
  }
  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (!note.title.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await api(`${base}/journal`, 'POST', { title: note.title.trim(), body: note.body.trim(), shared: note.shared });
      setNote(EMPTY);
      setAdding(false);
      setVersion(value => value + 1);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setSaving(false);
    }
  }
  async function saveEdit(entry: AiJournalEntry, value: Draft) {
    const result = await api<{ entry: AiJournalEntry }>(`${base}/journal/${encodeURIComponent(entry.id)}`, 'PATCH', { title: value.title.trim(), body: value.body.trim(), shared: value.shared });
    setEntries(previous => previous.map(item => (item.id === entry.id ? result.entry : item)));
    setEditing(null);
  }
  async function removeEntry(entry: AiJournalEntry) {
    if (!window.confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
    setError('');
    try {
      await api(`${base}/journal/${encodeURIComponent(entry.id)}`, 'DELETE');
      setEntries(previous => previous.filter(item => item.id !== entry.id));
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  return <div className="journal-workspace">
    <header className="journal-heading">
      <p className="journal-eyebrow">Adventure record</p>
      <h1>Journal</h1>
      <p>Chapters, notes, and events from your adventure, newest first.</p>
    </header>
    <div className="journal-toolbar">
      <div className="journal-filters" role="group" aria-label="Entry type">
        {FILTERS.map(item => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}
      </div>
      <label className="journal-search"><span>Search journal</span><input type="search" value={query} maxLength={200} placeholder="Titles and text" onChange={event => setQuery(event.target.value)} /></label>
    </div>
    {owner && <details className="journal-add" open={adding} onToggle={event => setAdding(event.currentTarget.open)}>
      <summary>Add note</summary>
      <form className="journal-form" onSubmit={addNote}>
        <label>Title<input required maxLength={200} value={note.title} onChange={event => setNote({ ...note, title: event.target.value })} /></label>
        <label>Text<textarea rows={4} maxLength={6000} value={note.body} onChange={event => setNote({ ...note, body: event.target.value })} /></label>
        <label className="journal-check"><input type="checkbox" checked={note.shared} onChange={event => setNote({ ...note, shared: event.target.checked })} /><span>Shared with players</span></label>
        <div className="journal-form-actions"><button className="daggery-primary" disabled={saving || !note.title.trim()}>{saving ? 'Saving…' : 'Save note'}</button></div>
      </form>
    </details>}
    {error && <div className="journal-error" role="alert"><p>{error}</p><button type="button" className="daggery-roll-toggle" onClick={() => setVersion(value => value + 1)}>Try again</button></div>}
    {loading && entries.length === 0 && !error && <p className="journal-status" role="status">Loading entries…</p>}
    {!loading && entries.length === 0 && !error && <div className="daggery-empty-state journal-empty"><Icon name="book" /><p>{search ? 'No entries match your search.' : 'No entries yet. The GM records events as the adventure unfolds.'}</p></div>}
    <div className="journal-timeline">
      {groupByChat(entries).map((group, index) => <section className="journal-group" key={`${index}-${group.label}`}>
        <h2>{group.label}</h2>
        <ol>
          {group.items.map(entry => <li key={entry.id}>
            {entry.kind === 'event' ? <EventRow entry={entry} />
              : editing === entry.id && owner && entry.editable ? <EntryEditor entry={entry} onSave={value => saveEdit(entry, value)} onCancel={() => setEditing(null)} />
              : <EntryCard entry={entry} owner={owner && entry.editable} onEdit={() => setEditing(entry.id)} onDelete={() => void removeEntry(entry)} />}
          </li>)}
        </ol>
      </section>)}
    </div>
    {cursor && <div className="journal-more"><button type="button" className="daggery-roll-toggle" disabled={moreBusy} onClick={() => void loadMore()}>{moreBusy ? 'Loading…' : 'Load older entries'}</button></div>}
  </div>;
}

function EventRow({ entry }: { entry: AiJournalEntry }) {
  return <div className="journal-event"><time dateTime={entry.createdAt}>{stampOf(entry.createdAt)}</time><span className="journal-event-text">{entry.title}{entry.body && <span> · {entry.body}</span>}</span><span className="journal-auto">Automatic</span></div>;
}

function EntryCard({ entry, owner, onEdit, onDelete }: { entry: AiJournalEntry; owner: boolean; onEdit: () => void; onDelete: () => void }) {
  return <article className={`journal-card journal-card-${entry.kind}`}>
    <header className="journal-card-head">
      <span className="journal-kind">{KIND_LABEL[entry.kind]}</span>
      <time dateTime={entry.createdAt}>{stampOf(entry.createdAt)}</time>
      {owner && <span className="journal-visibility">{entry.visibility === 'shared' ? 'Shared with players' : 'Only you'}</span>}
    </header>
    <h3>{entry.title}</h3>
    {entry.body && <p>{entry.body}</p>}
    {owner && <div className="journal-card-actions"><button type="button" className="daggery-roll-toggle" onClick={onEdit}><Icon name="custom" />Edit</button><button type="button" className="daggery-roll-toggle" onClick={onDelete}><Icon name="trash" />Delete</button></div>}
  </article>;
}

function EntryEditor({ entry, onSave, onCancel }: { entry: AiJournalEntry; onSave: (value: Draft) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState<Draft>({ title: entry.title, body: entry.body, shared: entry.visibility === 'shared' });
  const [busy, setBusy] = useState(false), [formError, setFormError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!value.title.trim() || busy) return;
    setBusy(true);
    setFormError('');
    try {
      await onSave(value);
    } catch (failure) {
      setFormError(errorText(failure));
      setBusy(false);
    }
  }
  return <form className="journal-form" onSubmit={save} aria-label={`Edit ${entry.title}`}>
    <label>Title<input required maxLength={200} value={value.title} onChange={event => setValue({ ...value, title: event.target.value })} /></label>
    <label>Text<textarea rows={5} maxLength={6000} value={value.body} onChange={event => setValue({ ...value, body: event.target.value })} /></label>
    <label className="journal-check"><input type="checkbox" checked={value.shared} onChange={event => setValue({ ...value, shared: event.target.checked })} /><span>Shared with players</span></label>
    {formError && <p role="alert" className="journal-form-error">{formError}</p>}
    <div className="journal-form-actions"><button className="daggery-primary" disabled={busy || !value.title.trim()}>{busy ? 'Saving…' : 'Save changes'}</button><button type="button" className="daggery-roll-toggle" onClick={onCancel}>Cancel</button></div>
  </form>;
}
