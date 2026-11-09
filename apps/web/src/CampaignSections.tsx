import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { getActiveCampaign } from './campaign-context';
import { uploadAsset } from './sync/store';
import { Icon } from './components/Icon';

const input = 'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100';
const button = 'daggery-roll-toggle';
interface Note { id: string; authorId: string; title: string; body: string; visibility: 'private' | 'shared' }
interface Asset { id: string; name: string; mediaType: string; size: number }
const base = () => `/api/campaigns/${encodeURIComponent(getActiveCampaign().id)}`;
const message = (e: unknown) => e instanceof Error ? e.message : 'Could not complete the action.';

export function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'shared'>('private');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => { const result = await api<{ notes: Note[] }>(`${base()}/notes`); setNotes(result.notes); }, []);
  useEffect(() => { void refresh().catch(e => setError(message(e))).finally(() => setLoading(false)); }, [refresh]);
  function clear() { setSelected(null); setTitle(''); setBody(''); setVisibility('private'); }
  async function save(event: FormEvent) {
    event.preventDefault(); setError('');
    try { await api(`${base()}/notes${selected ? `/${selected}` : ''}`, selected ? 'PUT' : 'POST', { title, body, visibility }); clear(); await refresh(); }
    catch (e) { setError(message(e)); }
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this note?')) return;
    try { await api(`${base()}/notes/${id}`, 'DELETE'); if (id === selected) clear(); await refresh(); }
    catch (e) { setError(message(e)); }
  }
  return <div className="daggery-home"><h1 className="icon-page-title"><Icon name="note" />Notes</h1><p>Private notes are visible only to their author. Shared notes can be edited by campaign members.</p>
    <div className="daggery-notes-layout mt-6 grid gap-5">
      <section aria-label="Note list" className="grid content-start gap-3"><input className={input} aria-label="Search notes" placeholder="Search your notes…" value={search} onChange={e => setSearch(e.target.value)} /><button className={button} onClick={clear}><Icon name="plus" />New note</button>{loading ? <p>Loading…</p> : notes.length === 0 ? <div className="daggery-empty-state"><Icon name="note" /><strong>A story worth remembering.</strong><p>Write your first note to keep the details close.</p></div> : notes.filter(n => `${n.title} ${n.body}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(note => <button key={note.id} className="daggery-shortcut" aria-current={selected === note.id ? 'true' : undefined} onClick={() => { setSelected(note.id); setTitle(note.title); setBody(note.body); setVisibility(note.visibility); }}><span><strong>{note.title}</strong><small>{note.visibility === 'private' ? 'Private' : 'Shared'}</small></span></button>)}{!loading && notes.length > 0 && !notes.some(n => `${n.title} ${n.body}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && <p className="text-sm text-slate-400">No notes match your search.</p>}</section>
      <form onSubmit={save} className="daggery-home-feature !mt-0 grid content-start gap-4"><h2>{selected ? 'Edit note' : 'New note'}</h2><label className="grid gap-1 text-sm">Title<input className={input} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required /></label><label className="grid gap-1 text-sm">Visibility<select className={input} value={visibility} onChange={e => setVisibility(e.target.value as 'private' | 'shared')}><option value="private">Private — only me</option><option value="shared">Shared — whole campaign</option></select></label><label className="grid gap-1 text-sm">Text<textarea className={`${input} min-h-64`} value={body} onChange={e => setBody(e.target.value)} maxLength={100000} /></label><div className="flex gap-2"><button className="daggery-primary" type="submit"><Icon name="check" />Save</button>{selected && <button className={button} type="button" onClick={() => void remove(selected)}><Icon name="trash" />Delete</button>}</div></form>
    </div>{error && <p role="alert" className="mt-4 text-rose-300">{error}</p>}</div>;
}

export function Library() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const campaign = getActiveCampaign();
  const refresh = useCallback(async () => { const result = await api<{ assets: Asset[] }>(`${base()}/assets`); setAssets(result.assets); }, []);
  useEffect(() => { void refresh().catch(e => setError(message(e))); }, [refresh]);
  return <div className="daggery-home"><h1 className="icon-page-title"><Icon name="library" />Library</h1><p>Images and PDFs for this campaign. For now, uploaded files are available only to the Game Master.</p>
    {campaign.role === 'gm' && <label className="daggery-primary mt-5 cursor-pointer"><Icon name="upload" />{busy ? 'Uploading…' : 'Upload file'}<input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,application/pdf" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setBusy(true); setError(''); void uploadAsset(file).then(refresh).catch(err => setError(message(err))).finally(() => setBusy(false)); }} /></label>}
    <div className="mt-6 grid gap-3">{assets.length === 0 ? <div className="daggery-empty-state"><Icon name="library" /><strong>Make room for your world.</strong><p>{campaign.role === 'gm' ? 'Upload maps, images, or PDFs to keep your campaign resources together.' : 'No files available yet.'}</p></div> : assets.map(asset => <a key={asset.id} className="daggery-shortcut" href={`${base()}/assets/${encodeURIComponent(asset.id)}`} target="_blank" rel="noreferrer"><span className="daggery-shortcut-icon"><Icon name={asset.mediaType==='application/pdf'?'pdf':'image'} /></span><span className="min-w-0"><strong className="break-words">{asset.name}</strong><small>{asset.mediaType} · {(asset.size / 1024 / 1024).toFixed(1)} MB</small></span></a>)}</div>{error && <p role="alert" className="mt-4 text-rose-300">{error}</p>}</div>;
}
