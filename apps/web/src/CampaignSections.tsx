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

/** Notes: one searchable card per note, each opening its edit form in place. */
export function Notes() {
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

  return <div className="sg-page campaign-page">
    <p className="sg-page-intro">Private notes are visible only to their author. Shared notes can be edited by campaign members.</p>
    <PanelSection title="Notes" storageKey="campaign.notes" actions={<IconButton icon="plus" tone="action" label="New note" onClick={startNew} />}>
      <SearchField value={search} onChange={setSearch} placeholder="Search your notes…" label="Search notes" />
      {error && <p role="alert" className="cs-error">{error}</p>}
      {creating && <ItemCard title="New note" caption="Not saved yet" open onToggle={() => setCreating(false)}>
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
              caption={note.visibility === 'private' ? 'Private' : 'Shared'}
              icon={note.visibility === 'private' ? 'lock' : 'users'}
              tone={note.visibility === 'private' ? TONES.violet : TONES.teal}
              open={selected === note.id}
              onToggle={() => open(note)}>
              <NoteForm title={title} setTitle={setTitle} visibility={visibility} setVisibility={setVisibility} body={body} setBody={setBody} onSave={save} onDelete={() => void remove(note.id)} />
            </ItemCard>)}
    </PanelSection>
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
    <label className="cs-field">Visibility<select value={visibility} onChange={e => setVisibility(e.target.value as 'private' | 'shared')}><option value="private">Private — only me</option><option value="shared">Shared — whole campaign</option></select></label>
    <label className="cs-field">Text<textarea value={body} onChange={e => setBody(e.target.value)} maxLength={100000} /></label>
    <div className="cs-form-actions">
      <button className="daggery-primary" type="submit"><Icon name="check" />Save</button>
      {onDelete && <button className="daggery-roll-toggle" type="button" onClick={onDelete}><Icon name="trash" />Delete</button>}
    </div>
  </form>;
}

/** Library: images and PDFs, each in its own group and opened from a row. */
export function Library() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const campaign = getActiveCampaign();
  const refresh = useCallback(async () => { const result = await api<{ assets: Asset[] }>(`${base()}/assets`); setAssets(result.assets); }, []);
  useEffect(() => { void refresh().catch(e => setError(message(e))); }, [refresh]);

  const images = assets.filter(asset => asset.mediaType !== 'application/pdf');
  const documents = assets.filter(asset => asset.mediaType === 'application/pdf');

  const file = (asset: Asset) => {
    const pdf = asset.mediaType === 'application/pdf';
    const href = `${base()}/assets/${encodeURIComponent(asset.id)}`;
    return <Row key={asset.id}
      leading={<span className="cs-file-icon"><Icon name={pdf ? 'pdf' : 'image'} /></span>}
      label={asset.name}
      value={`${asset.mediaType} · ${(asset.size / 1024 / 1024).toFixed(1)} MB`}
      action={<a className="sg-icon-button cs-file-open" href={href} target="_blank" rel="noreferrer" aria-label={`Open ${asset.name}`} title={`Open ${asset.name}`}><Icon name="arrow" /></a>}
    />;
  };

  const upload = campaign.role === 'gm' ? <label className="cs-upload">
    <Icon name="upload" /><span>{busy ? 'Uploading…' : 'Upload'}</span>
    <input className="cs-visually-hidden" type="file" aria-label="Upload file" accept="image/png,image/jpeg,image/webp,application/pdf" disabled={busy} onChange={e => { const picked = e.target.files?.[0]; e.target.value = ''; if (!picked) return; setBusy(true); setError(''); void uploadAsset(picked).then(refresh).catch(err => setError(message(err))).finally(() => setBusy(false)); }} />
  </label> : undefined;

  return <div className="sg-page campaign-page">
    <p className="sg-page-intro">Images and PDFs for this campaign. For now, uploaded files are available only to the Game Master.</p>
    <PanelSection title="Library" storageKey="campaign.library" actions={upload}>
      {error && <p role="alert" className="cs-error">{error}</p>}
      {assets.length === 0
        ? <p className="sg-empty">{campaign.role === 'gm' ? 'Upload maps, images, or PDFs to keep your campaign resources together.' : 'No files available yet.'}</p>
        : <>
          <Group title="Images" icon="image" count={images.length} defaultOpen>{images.length ? images.map(file) : <p className="sg-empty">No images yet.</p>}</Group>
          <Group title="Documents" icon="pdf" count={documents.length} defaultOpen>{documents.length ? documents.map(file) : <p className="sg-empty">No PDFs yet.</p>}</Group>
        </>}
    </PanelSection>
  </div>;
}
