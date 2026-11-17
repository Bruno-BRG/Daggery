import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { environments } from '@daggery/content';
import { Icon, type IconName } from '../../components/Icon';
import { Group, IconButton, ItemCard, PanelSection, Row, SearchField, TONES } from '../../components/Accordion';
import { useDocs, useSyncStatus } from '../../sync/store';
import {
  entityDraft, lootEntries, lootTableName, RARITIES,
  SETTING_FIELDS, THREAD_FIELDS,
  type CampaignDoc, type EntityDoc, type EntityDraft, type LootDoc, type LootSet, type LootTable, type PrepDoc,
} from './model';
import './campaign.css';

/**
 * The campaign page: the world, its people and places, the threads the hero follows, and
 * the printed loot tables. It replaces the previous campaign preparation page, keeping its
 * saved documents (the setting, scenarios as threads, and the loot log) and its
 * save/dirty/confirm rules.
 *
 * Everything is a reference for solo play: the tables are printed, and nothing here rolls.
 */

const ENTITY_META: Record<EntityDoc['kind'], {
  label: string; addLabel: string; detailLabel: string; emptyTitle: string;
  emptyCaption: string; emptyState: string; icon: IconName; tone: string;
}> = {
  npc: {
    label: 'person', addLabel: 'Add a person', detailLabel: 'Role or relationship',
    emptyTitle: 'New person', emptyCaption: 'Someone in the story',
    emptyState: 'No people yet. Add the first face your hero meets.',
    icon: 'users', tone: TONES.pink,
  },
  place: {
    label: 'place', addLabel: 'Add a place', detailLabel: 'Type of place',
    emptyTitle: 'New place', emptyCaption: 'A place in the world',
    emptyState: 'No places yet. Add the first place your hero can visit.',
    icon: 'map', tone: TONES.green,
  },
};

export default function Campaign({ author: _author }: { author: string }) {
  return <Workspace />;
}

interface DirtyState { setting: boolean; threads: boolean; people: boolean; places: boolean }
const NO_DIRTY: DirtyState = { setting: false, threads: false, people: false, places: false };

function Workspace() {
  const docs = useDocs<CampaignDoc>('gm');
  const connected = useSyncStatus() === 'open';
  const [dirty, setDirty] = useState<DirtyState>(NO_DIRTY);
  const [settingOpen, setSettingOpen] = usePersistentFold('campaign.setting', true);
  const [threadsOpen, setThreadsOpen] = usePersistentFold('campaign.threads', true);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [newThreadKey, setNewThreadKey] = useState(0);
  const anyDirty = dirty.setting || dirty.threads || dirty.people || dirty.places;

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (anyDirty) event.preventDefault(); };
    const navigating = (event: Event) => { if (anyDirty && !window.confirm('Discard your unsaved campaign notes?')) event.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    window.addEventListener('daggery:before-navigate', navigating);
    return () => { window.removeEventListener('beforeunload', handler); window.removeEventListener('daggery:before-navigate', navigating); };
  }, [anyDirty]);

  const markSetting = useCallback((value: boolean) => setDirty(current => current.setting === value ? current : { ...current, setting: value }), []);
  const markThreads = useCallback((value: boolean) => setDirty(current => current.threads === value ? current : { ...current, threads: value }), []);
  const markPeople = useCallback((value: boolean) => setDirty(current => current.people === value ? current : { ...current, people: value }), []);
  const markPlaces = useCallback((value: boolean) => setDirty(current => current.places === value ? current : { ...current, places: value }), []);

  const settingDoc = docs.items.setting;
  const setting = settingDoc?.kind === 'setting' ? settingDoc : undefined;
  const threads = Object.entries(docs.items)
    .filter((entry): entry is [string, PrepDoc] => entry[1].kind === 'scenario')
    .sort((a, b) => b[1].updated.localeCompare(a[1].updated));

  function toggleSetting(next: boolean) {
    if (!next && dirty.setting && !window.confirm('Discard your unsaved setting?')) return;
    if (!next) markSetting(false);
    setSettingOpen(next);
  }

  function toggleThreads(next: boolean) {
    if (!next && dirty.threads && !window.confirm('Discard your unsaved thread?')) return;
    if (!next) markThreads(false);
    setThreadsOpen(next);
  }

  function toggleThread(id: string, next: boolean) {
    if (!next) {
      if (dirty.threads && !window.confirm('Discard your unsaved thread?')) return;
      markThreads(false);
      setOpenThread(null);
      return;
    }
    if (openThread !== id) {
      if (dirty.threads && !window.confirm('Discard your unsaved thread?')) return;
      markThreads(false);
      setOpenThread(id);
    }
  }

  function startThread() {
    if (dirty.threads && !window.confirm('Discard your unsaved thread?')) return;
    markThreads(false);
    setThreadsOpen(true);
    setOpenThread('new');
    setNewThreadKey(value => value + 1);
  }

  function createdThread(id: string) {
    markThreads(false);
    setOpenThread(id);
    setNewThreadKey(value => value + 1);
  }

  function removeThread(id: string) {
    docs.remove(id);
    if (openThread === id) setOpenThread(null);
    markThreads(false);
  }

  return <div className="sg-page campaign-page">
    <header className="campaign-heading">
      <div>
        <p className="campaign-kicker">Your campaign</p>
        <h1><Icon name="compass" />Campaign</h1>
        <p>The world, the people, and the threads your hero moves through.</p>
      </div>
    </header>
    {!connected && <p role="status" className="campaign-notice">Connecting… Saving will be available when the campaign reconnects.</p>}

    <PanelSection id="campaign-setting" title="Setting & truths" storageKey="campaign.setting" open={settingOpen} onToggle={toggleSetting}>
      <Group title="Campaign setting" icon="tree" defaultOpen>
        <PrepEditor key="setting" id="setting" kind="setting" existing={setting} save={docs.set} connected={connected} onDirty={markSetting} />
      </Group>
    </PanelSection>

    <EntityPanel kind="npc" title="People" sectionId="campaign-people" storageKey="campaign.people" defaultOpen
      items={docs.items} save={docs.set} remove={docs.remove} connected={connected} onDirty={markPeople} />

    <EntityPanel kind="place" title="Places" sectionId="campaign-places" storageKey="campaign.places" defaultOpen={false}
      items={docs.items} save={docs.set} remove={docs.remove} connected={connected} onDirty={markPlaces} />

    <PanelSection id="campaign-threads" title="Threads" storageKey="campaign.threads" open={threadsOpen} onToggle={toggleThreads}
      actions={<IconButton icon="plus" tone="action" label="New thread" onClick={startThread} />}>
      {threads.length === 0 && openThread !== 'new'
        ? <p className="sg-empty">No threads yet. Start with a hook, then add the stakes and scenes.</p>
        : <div className="campaign-cards">
          {openThread === 'new' && <ItemCard key={`new-thread-${newThreadKey}`} title="New thread" caption="Write the hook and the stakes"
            icon="scroll" tone={TONES.violet} open onToggle={next => toggleThread('new', next)}>
            <PrepEditor key={`new-thread-${newThreadKey}`} kind="scenario" save={docs.set} connected={connected} onDirty={markThreads} onCreated={createdThread} />
          </ItemCard>}
          {threads.map(([id, thread]) => <ItemCard key={id} title={thread.title || 'Untitled thread'} caption={threadCaption(thread)}
            icon="scroll" tone={TONES.violet} open={openThread === id} onToggle={next => toggleThread(id, next)}>
            <PrepEditor id={id} kind="scenario" existing={thread} save={docs.set} connected={connected} onDirty={markThreads} remove={removeThread} />
          </ItemCard>)}
        </div>}
    </PanelSection>

    <PanelSection id="campaign-loot" title="Loot" storageKey="campaign.loot" defaultOpen={false}>
      <Loot items={docs.items} remove={docs.remove} connected={connected} />
    </PanelSection>
  </div>;
}

function threadCaption(thread: PrepDoc): string {
  const environment = environments.find(entry => entry.id === thread.environmentId);
  const status = thread.status.charAt(0).toUpperCase() + thread.status.slice(1);
  return [status, environment?.name].filter(Boolean).join(' · ');
}

// ------------------------------------------------------------------- people and places

function EntityPanel({ kind, title, sectionId, storageKey, defaultOpen, items, save, remove, connected, onDirty }: {
  kind: EntityDoc['kind']; title: string; sectionId: string; storageKey: string; defaultOpen: boolean;
  items: Record<string, CampaignDoc>; save: (id: string, doc: CampaignDoc) => void; remove: (id: string) => void;
  connected: boolean; onDirty: (dirty: boolean) => void;
}) {
  const meta = ENTITY_META[kind];
  const [openSection, setOpenSection] = usePersistentFold(storageKey, defaultOpen);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const markDirty = useCallback((value: boolean) => { setDirty(value); onDirty(value); }, [onDirty]);
  const entries = Object.entries(items)
    .filter((entry): entry is [string, EntityDoc] => entry[1].kind === kind)
    .sort((a, b) => b[1].updated.localeCompare(a[1].updated));

  const leave = () => !dirty || window.confirm('Discard your unsaved changes?');

  function toggleSection(next: boolean) {
    if (!next && !leave()) return;
    if (!next) { markDirty(false); setOpenId(null); }
    setOpenSection(next);
  }

  function toggleCard(id: string, next: boolean) {
    if (!next) {
      if (!leave()) return;
      markDirty(false);
      setOpenId(null);
      return;
    }
    if (openId !== id) {
      if (!leave()) return;
      markDirty(false);
      setOpenId(id);
    }
  }

  function add() {
    if (!leave()) return;
    markDirty(false);
    setOpenSection(true);
    setOpenId('new');
    setNewKey(value => value + 1);
  }

  function created(id: string) {
    markDirty(false);
    setOpenId(id);
    setNewKey(value => value + 1);
  }

  function deleted(id: string) {
    remove(id);
    if (openId === id) setOpenId(null);
    markDirty(false);
  }

  return <PanelSection id={sectionId} title={title} storageKey={storageKey} open={openSection} onToggle={toggleSection}
    actions={<IconButton icon="plus" tone="action" label={meta.addLabel} onClick={add} />}>
    {entries.length === 0 && openId !== 'new'
      ? <p className="sg-empty">{meta.emptyState}</p>
      : <div className="campaign-cards">
        {openId === 'new' && <ItemCard key={`new-${kind}-${newKey}`} title={meta.emptyTitle} caption={meta.emptyCaption}
          icon={meta.icon} tone={meta.tone} open onToggle={next => toggleCard('new', next)}>
          <EntityEditor key={`new-${kind}-${newKey}`} kind={kind} save={save} connected={connected} onDirty={markDirty} onCreated={created} />
        </ItemCard>}
        {entries.map(([id, entry]) => <ItemCard key={id} title={entry.name || meta.emptyTitle} caption={entityCaption(entry)}
          icon={meta.icon} tone={meta.tone} open={openId === id} onToggle={next => toggleCard(id, next)}>
          <EntityEditor id={id} kind={kind} existing={entry} save={save} connected={connected} onDirty={markDirty} remove={deleted} />
        </ItemCard>)}
      </div>}
  </PanelSection>;
}

function entityCaption(doc: EntityDoc): string {
  if (doc.kind === 'npc') return doc.role || ENTITY_META.npc.emptyCaption;
  return doc.type || ENTITY_META.place.emptyCaption;
}

function EntityEditor({ id, kind, existing, save, connected, onDirty, onCreated, remove }: {
  id?: string; kind: EntityDoc['kind']; existing?: EntityDoc; save: (id: string, doc: CampaignDoc) => void;
  connected: boolean; onDirty: (dirty: boolean) => void; onCreated?: (id: string) => void; remove?: (id: string) => void;
}) {
  const meta = ENTITY_META[kind];
  const [draft, setDraft] = useState<EntityDraft>(() => entityDraft(existing));
  const [pending, setPending] = useState<{ id: string; updated: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [edited, setEdited] = useState(false);
  const dirty = edited && JSON.stringify(draft) !== JSON.stringify(entityDraft(existing));

  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (pending && existing?.updated === pending.updated) { setPending(null); setSaved(true); setEdited(false); }
    if (existing && !edited && !pending) setDraft(entityDraft(existing));
  }, [existing, pending, edited]);
  useEffect(() => { if (!connected) setPending(null); }, [connected]);
  useEffect(() => { const handler = () => setPending(null); window.addEventListener('daggery:sync-error', handler); return () => window.removeEventListener('daggery:sync-error', handler); }, []);

  function change(value: Partial<EntityDraft>) { setDraft(old => ({ ...old, ...value })); setEdited(true); setSaved(false); }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!connected || !draft.name.trim()) return;
    const updated = new Date().toISOString();
    const next: EntityDoc = kind === 'npc'
      ? { kind: 'npc', name: draft.name.trim(), role: draft.detail.trim(), notes: draft.notes, updated }
      : { kind: 'place', name: draft.name.trim(), type: draft.detail.trim(), notes: draft.notes, updated };
    if (new Blob([JSON.stringify(next)]).size > 60000) { setError('This entry is too long to save. Shorten the notes.'); return; }
    setError('');
    const docId = id ?? `${kind}:${crypto.randomUUID()}`;
    save(docId, next);
    setDraft({ name: next.name, detail: draft.detail.trim(), notes: next.notes });
    setPending({ id: docId, updated });
  }

  return <form className="campaign-editor" onSubmit={submit}>
    <fieldset disabled={!!pending} className="campaign-editor-fields">
      <label className="campaign-field">{kind === 'npc' ? 'Name' : 'Place name'}<input required maxLength={200} value={draft.name} onChange={event => change({ name: event.target.value })} placeholder={kind === 'npc' ? 'Who is this?' : 'What is this place called?'} /></label>
      <label className="campaign-field">{meta.detailLabel}<input maxLength={200} value={draft.detail} onChange={event => change({ detail: event.target.value })} placeholder={kind === 'npc' ? 'Ally, rival, stranger…' : 'Town, ruin, wilderness…'} /></label>
      <label className="campaign-field">Notes<textarea rows={4} maxLength={6000} value={draft.notes} onChange={event => change({ notes: event.target.value })} placeholder={kind === 'npc' ? 'What do they want? What do they remember?' : 'What is here? What has happened here?'} /></label>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <footer className="campaign-save-bar">
      <button className="daggery-primary" disabled={!connected || !!pending} type="submit"><Icon name="check" />{pending ? 'Saving…' : `Save ${meta.label}`}</button>
      <span role="status" className="campaign-muted">{dirty ? 'Unsaved changes' : saved ? 'Saved' : existing ? 'Saved to this campaign' : ''}</span>
      {id && remove && <button className="daggery-roll-toggle campaign-delete" type="button" disabled={!connected} onClick={() => { if (window.confirm(`Delete “${draft.name || meta.emptyTitle}”?`)) remove(id); }}><Icon name="trash" />Delete</button>}
    </footer>
    {!id && pending && <CreatedObserver id={pending.id} updated={pending.updated} onCreated={onCreated} />}
  </form>;
}

// ------------------------------------------------------------------- setting and threads

const emptyPrep = (kind: PrepDoc['kind']): PrepDoc => ({ kind, title: '', fields: {}, environmentId: '', status: 'planned', updated: '' });

function PrepEditor({ id, kind, existing, save, connected, onDirty, onCreated, remove }: {
  id?: string; kind: PrepDoc['kind']; existing?: PrepDoc; save: (id: string, doc: CampaignDoc) => void;
  connected: boolean; onDirty: (dirty: boolean) => void; onCreated?: (id: string) => void; remove?: (id: string) => void;
}) {
  const [draft, setDraft] = useState<PrepDoc>(() => existing ?? emptyPrep(kind));
  const [pending, setPending] = useState<{ id: string; updated: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [edited, setEdited] = useState(false);
  const environment = environments.find(entry => entry.id === draft.environmentId);
  const dirty = edited && JSON.stringify(draft) !== JSON.stringify(existing ?? emptyPrep(kind));
  const fields = kind === 'setting' ? SETTING_FIELDS : THREAD_FIELDS;

  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (pending && existing?.updated === pending.updated) { setPending(null); setSaved(true); setEdited(false); }
    if (existing && !edited && !pending) setDraft(existing);
  }, [existing, pending, edited]);
  useEffect(() => { if (!connected) setPending(null); }, [connected]);
  useEffect(() => { const handler = () => setPending(null); window.addEventListener('daggery:sync-error', handler); return () => window.removeEventListener('daggery:sync-error', handler); }, []);

  function change(value: Partial<PrepDoc>) { setDraft(old => ({ ...old, ...value })); setEdited(true); setSaved(false); }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!connected || !draft.title.trim()) return;
    const next = { ...draft, title: draft.title.trim(), updated: new Date().toISOString() };
    if (new Blob([JSON.stringify(next)]).size > 60000) {
      setError(kind === 'setting' ? 'This setting is too long to save. Shorten the notes.' : 'This thread is too long to save. Shorten the notes or split it into separate threads.');
      return;
    }
    setError('');
    const docId = id ?? `scenario:${crypto.randomUUID()}`;
    save(docId, next);
    setDraft(next);
    setPending({ id: docId, updated: next.updated });
  }

  return <form className="campaign-editor" onSubmit={submit}>
    <fieldset disabled={!!pending} className="campaign-editor-fields">
      <label className="campaign-field">{kind === 'setting' ? 'Setting name' : 'Thread title'}<input required maxLength={200} value={draft.title} onChange={event => change({ title: event.target.value })} placeholder={kind === 'setting' ? 'Name your world or campaign frame' : 'Give this thread a name'} /></label>
      {kind === 'scenario' && <div className="campaign-form-row">
        <label className="campaign-field">Status<select aria-label="Status" value={draft.status} onChange={event => change({ status: event.target.value as PrepDoc['status'] })}><option value="planned">Planned</option><option value="active">Active</option><option value="complete">Complete</option></select></label>
        <label className="campaign-field">Environment reference<select aria-label="Environment reference" value={draft.environmentId} onChange={event => change({ environmentId: event.target.value })}><option value="">No environment</option>{environments.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · Tier {entry.tier}</option>)}</select></label>
      </div>}
      <div className="campaign-fields">{fields.map(([key, label, placeholder]) => <label className="campaign-field" key={key}>{label}<textarea rows={4} maxLength={6000} value={draft.fields[key] ?? ''} placeholder={placeholder} onChange={event => change({ fields: { ...draft.fields, [key]: event.target.value } })} /></label>)}</div>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {environment && <details className="campaign-environment" open><summary>{environment.name} · Tier {environment.tier} · {environment.type}</summary><p>{environment.description}</p><p><strong>Difficulty {environment.difficulty}</strong> · {environment.impulses}</p><p><strong>Potential adversaries:</strong> {environment.potentialAdversaries}</p>{environment.features.map(feature => <section key={feature.name}><h3>{feature.name} <small>{feature.kind}</small></h3><p>{feature.text}</p>{('questions' in feature ? feature.questions : []).map(question => <p className="campaign-muted" key={question}>{question}</p>)}</section>)}</details>}
    <footer className="campaign-save-bar">
      <button className="daggery-primary" disabled={!connected || !!pending} type="submit"><Icon name="check" />{pending ? 'Saving…' : kind === 'setting' ? 'Save setting' : 'Save thread'}</button>
      <span role="status" className="campaign-muted">{dirty ? 'Unsaved changes' : saved ? 'Saved' : existing ? 'Saved to this campaign' : ''}</span>
      {id && remove && <button className="daggery-roll-toggle campaign-delete" type="button" disabled={!connected} onClick={() => { if (window.confirm(`Delete “${draft.title}”?`)) remove(id); }}><Icon name="trash" />Delete</button>}
    </footer>
    {!id && pending && <CreatedObserver id={pending.id} updated={pending.updated} onCreated={onCreated} />}
  </form>;
}

function CreatedObserver({ id, updated, onCreated }: { id: string; updated: string; onCreated?: (id: string) => void }) {
  const { items } = useDocs<CampaignDoc>('gm');
  useEffect(() => { if (items[id]?.updated === updated) onCreated?.(id); }, [items, id, updated, onCreated]);
  return null;
}

// ------------------------------------------------------------------- loot

/** The printed tables, read with physical dice. The log keeps loot saved before. */
function Loot({ items, remove, connected }: { items: Record<string, CampaignDoc>; remove: (id: string) => void; connected: boolean }) {
  const [table, setTable] = useState<LootTable>('items');
  const [lootSet, setLootSet] = useState<LootSet>('core');
  const [search, setSearch] = useState('');
  const log = Object.entries(items).filter((entry): entry is [string, LootDoc] => entry[1].kind === 'loot').sort((a, b) => b[1].updated.localeCompare(a[1].updated));
  const entries = lootEntries(table, lootSet).filter(entry => `${entry.roll} ${entry.name} ${entry.description}`.toLowerCase().includes(search.toLowerCase()));

  return <>
    <Group title="Rarity and dice" icon="chest" defaultOpen>
      <p className="campaign-help">Roll the dice for the rarity, add them, and read the matching row of the table below.</p>
      {Object.entries(RARITIES).map(([name, pools]) => <Row key={name} label={name} value={pools.map(n => `${n}d12`).join(' or ')} />)}
    </Group>
    <Group title={lootTableName(table, lootSet)} icon="grid" count={entries.length} defaultOpen>
      <div className="campaign-form-row">
        <label className="campaign-field">Table<select aria-label="Table" value={table} onChange={event => { setTable(event.target.value as LootTable); setSearch(''); }}><option value="items">Items</option><option value="consumables">Consumables</option></select></label>
        <label className="campaign-field">Source<select aria-label="Table source" value={lootSet} onChange={event => { setLootSet(event.target.value as LootSet); setSearch(''); }}><option value="core">Core Set</option><option value="additional">Additional (Hope &amp; Fear)</option></select></label>
      </div>
      <SearchField value={search} onChange={setSearch} placeholder="Name, effect, or roll number" label="Search table" />
      {entries.length === 0
        ? <p className="sg-empty">No entries match your search.</p>
        : entries.map(entry => <Row key={entry.id} leading={<span className="campaign-roll-number">{String(entry.roll).padStart(2, '0')}</span>} label={entry.name} value={entry.description} />)}
      <p className="campaign-help">Daggerheart Core Rulebook and Hope &amp; Fear · <a href="https://www.daggerheart.com/srd/" target="_blank" rel="noreferrer">System Reference Document</a></p>
    </Group>
    {log.length > 0 && <Group title="Loot log" icon="chest" count={log.length}>
      {log.map(([id, entry]) => <ItemCard key={id}
        title={entry.name}
        caption={`${lootTableName(entry.table, entry.set)} · Roll ${entry.total}`}
        tone={TONES.gold}
        actions={<IconButton icon="trash" tone="danger" label={`Remove ${entry.name}`} disabled={!connected} onClick={() => { if (window.confirm(`Remove “${entry.name}” from the loot log?`)) remove(id); }} />}>
        {entry.note && <p>{entry.note}</p>}
        <p>{entry.description}</p>
      </ItemCard>)}
    </Group>}
  </>;
}

// ------------------------------------------------------------------- fold memory

/** Folds like the layout kit, but controlled so a dirty editor can refuse to close. */
function usePersistentFold(storageKey: string, defaultOpen: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try { const saved = localStorage.getItem(`daggery.fold.${storageKey}`); return saved === null ? defaultOpen : saved === '1'; } catch { return defaultOpen; }
  });
  const set = useCallback((value: boolean) => {
    setOpen(value);
    try { localStorage.setItem(`daggery.fold.${storageKey}`, value ? '1' : '0'); } catch { /* storage blocked */ }
  }, [storageKey]);
  return [open, set];
}
