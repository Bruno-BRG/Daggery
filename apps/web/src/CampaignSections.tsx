import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { getActiveCampaign } from './campaign-context';
import { uploadAsset } from './sync/store';
import { Icon } from './components/Icon';
import { Group, IconButton, ItemCard, PanelSection, Row, SearchField, TONES } from './components/Accordion';
import './campaignSections.css';

interface Note { id: string; authorId: string; title: string; body: string; visibility: 'private' | 'shared' }
interface Asset { id: string; name: string; mediaType: string; size: number }
const base = () => `/api/campaigns/${encodeURIComponent(getActiveCampaign().id)}`;
const message = (e: unknown) => e instanceof Error ? e.message : 'Could not complete the action.';

/**
 * Notes: one searchable card per note, each opening its edit form in place.
 * `embedded` renders just the list, for the Journal part of the solo screen.
 */
export function Notes({ embedded = false }: { embedded?: boolean } = {}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'shared'>('private');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => { const result = await api<{ notes: Note[] }>(`${base()}/notes`); setNotes(result.notes); }, []);
  useEffect(() => { void refresh().catch(e => setError(message(e))).finally(() => setLoading(false)); }, [refresh]);

  function reset() { setSelected(null); setCreating(false); setTitle(''); setBody(''); setVisibility('private'); }
  function startNew() { setSelected(null); setCreating(true); setTitle(''); setBody(''); setVisibility('private'); setError(''); }
  function open(note: Note) {
    if (selected === note.id) { setSelected(null); return; }
    setCreating(false);
    setSelected(note.id);
    setTitle(note.title);
    setBody(note.body);
    setVisibility(note.visibility);
  }

  async function save(event: FormEvent) {
    event.preventDefault(); setError('');
    try { await api(`${base()}/notes${selected ? `/${selected}` : ''}`, selected ? 'PUT' : 'POST', { title, body, visibility }); reset(); await refresh(); }
    catch (e) { setError(message(e)); }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this note?')) return;
    try { await api(`${base()}/notes/${id}`, 'DELETE'); if (id === selected) reset(); await refresh(); }
    catch (e) { setError(message(e)); }
  }

  const query = search.toLocaleLowerCase();
  const filtered = notes.filter(note => `${note.title} ${note.body}`.toLocaleLowerCase().includes(query));

  const list = <>
      {embedded && <div className="cs-journal-bar">
        <IconButton icon="plus" tone="action" label="New journal entry" onClick={startNew} />
        <SearchField value={search} onChange={setSearch} placeholder="Search by title or content" label="Search the journal" />
      </div>}
      {!embedded && <SearchField value={search} onChange={setSearch} placeholder="Search your notes…" label="Search notes" />}
      {error && <p role="alert" className="cs-error">{error}</p>}
      {creating && <ItemCard title={embedded ? 'New journal entry' : 'New note'} caption="Not saved yet" open onToggle={() => setCreating(false)}>
        <NoteForm title={title} setTitle={setTitle} visibility={visibility} setVisibility={setVisibility} body={body} setBody={setBody} onSave={save} />
      </ItemCard>}
      {loading
        ? <p className="cs-muted" role="status">Loading…</p>
        : notes.length === 0
          ? <p className="sg-empty">A story worth remembering. Write your first note to keep the details close.</p>
          : filtered.length === 0
            ? <p className="sg-empty">No notes match your search.</p>
            : filtered.map(note => <ItemCard key={note.id}
              title={note.title}
              tone={TONES.teal}
              open={selected === note.id}
              onToggle={() => open(note)}>
              <NoteForm title={title} setTitle={setTitle} visibility={visibility} setVisibility={setVisibility} body={body} setBody={setBody} onSave={save} onDelete={() => void remove(note.id)} />
            </ItemCard>)}
  </>;
  if (embedded) return <div className="cs-journal">{list}</div>;
  return <div className="sg-page campaign-page">
    <p className="sg-page-intro">Your notes are also your journal in the panel on the right.</p>
    <PanelSection title="Notes" storageKey="campaign.notes" actions={<IconButton icon="plus" tone="action" label="New note" onClick={startNew} />}>{list}</PanelSection>
  </div>;
}

function NoteForm({ title, setTitle, visibility, setVisibility, body, setBody, onSave, onDelete }: {
  title: string; setTitle: (value: string) => void;
  visibility: 'private' | 'shared'; setVisibility: (value: 'private' | 'shared') => void;
  body: string; setBody: (value: string) => void;
  onSave: (event: FormEvent) => void; onDelete?: () => void;
}) {
  return <form className="cs-form" onSubmit={onSave}>
    <label className="cs-field">Title<input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required /></label>
    <label className="cs-field">Text<textarea value={body} onChange={e => setBody(e.target.value)} maxLength={100000} /></label>
    <div className="cs-form-actions">
      <button className="daggery-primary" type="submit"><Icon name="check" />Save</button>
      {onDelete && <button className="daggery-roll-toggle" type="button" onClick={onDelete}><Icon name="trash" />Delete</button>}
    </div>
  </form>;
}

