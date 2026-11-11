import { useEffect, useState, type FormEvent } from 'react';
import { environments } from '@daggery/content';
import { getActiveCampaign } from '../../campaign-context';
import { Icon } from '../../components/Icon';
import { useDocs, useSyncStatus } from '../../sync/store';
import { lootEntries, lootTableName, RARITIES, rollLoot, SCENARIO_FIELDS, SETTING_FIELDS, type GmDoc, type LootDoc, type LootSet, type LootTable, type PrepDoc } from './model';
import './gm.css';

type Tab = 'loot' | 'setting' | 'scenarios';
const emptyPrep = (kind: PrepDoc['kind']): PrepDoc => ({ kind, title: '', fields: {}, environmentId: '', status: 'planned', updated: '' });

export default function GmTools({ author: _author }: { author: string }) {
  if (getActiveCampaign().role !== 'gm') return <p>GM tools are available to the Game Master.</p>;
  return <Workspace />;
}

function Workspace() {
  const docs = useDocs<GmDoc>('gm');
  const connected = useSyncStatus() === 'open';
  const [tab, setTab] = useState<Tab>('loot');
  const [selected, setSelected] = useState('new');
  const [dirty, setDirty] = useState(false);
  const [newKey, setNewKey] = useState(0);
  const scenarios = Object.entries(docs.items).filter((entry): entry is [string, PrepDoc] => entry[1].kind === 'scenario').sort((a, b) => b[1].updated.localeCompare(a[1].updated));
  const leave = () => !dirty || window.confirm('Discard your unsaved changes?');
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    const navigating = (event: Event) => { if (dirty && !window.confirm('Discard your unsaved GM preparation?')) event.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    window.addEventListener('daggery:before-navigate', navigating);
    return () => { window.removeEventListener('beforeunload', handler); window.removeEventListener('daggery:before-navigate', navigating); };
  }, [dirty]);
  return <div className="gm-workspace">
    <header className="gm-heading"><div><p className="gm-kicker">Campaign preparation</p><h1><Icon name="compass" />GM tools</h1><p>Prepare the world. Keep what you need at the table.</p></div><span className="gm-private"><Icon name="lock" />GM only</span></header>
    <nav className="gm-tabs" aria-label="GM tools">
      {([['loot', 'chest', 'Loot tables'], ['setting', 'tree', 'Setting'], ['scenarios', 'scroll', 'Scenarios']] as const).map(([id, icon, label]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => { if (id !== tab && leave()) { setDirty(false); setTab(id); } }}><Icon name={icon} />{label}</button>)}
    </nav>
    {!connected && <p role="status" className="gm-notice">Connecting… Saving will be available when the campaign reconnects.</p>}
    {tab === 'loot' ? <Loot items={docs.items} save={docs.set} remove={docs.remove} connected={connected} /> : tab === 'setting' ?
      <PrepEditor key="setting" id="setting" kind="setting" existing={docs.items.setting?.kind === 'setting' ? docs.items.setting : undefined} save={docs.set} connected={connected} onDirty={setDirty} /> :
      <div className="gm-prep-layout">
        <aside className="gm-scenario-list" aria-label="Scenarios"><button className="daggery-roll-toggle" onClick={() => { if (leave()) { setSelected('new'); setNewKey(n => n + 1); setDirty(false); } }}><Icon name="plus" />New scenario</button>
          {scenarios.length === 0 && <p className="gm-empty">No scenarios yet. Start with a hook, then add the stakes and scenes.</p>}
          {scenarios.map(([id, scenario]) => <button key={id} className="gm-scenario-link" aria-current={selected === id ? 'true' : undefined} onClick={() => { if (id !== selected && leave()) { setDirty(false); setSelected(id); } }}><strong>{scenario.title}</strong><small>{scenario.status}</small></button>)}
        </aside>
        <PrepEditor key={`${selected}-${newKey}`} id={selected === 'new' ? undefined : selected} kind="scenario" existing={selected !== 'new' && docs.items[selected]?.kind === 'scenario' ? docs.items[selected] as PrepDoc : undefined} save={docs.set} connected={connected} onDirty={setDirty} onCreated={setSelected} remove={id => { docs.remove(id); setSelected('new'); setDirty(false); }} />
      </div>}
  </div>;
}

function PrepEditor({ id, kind, existing, save, connected, onDirty, onCreated, remove }: {
  id?: string; kind: PrepDoc['kind']; existing?: PrepDoc; save: (id: string, value: GmDoc) => void; connected: boolean;
  onDirty: (dirty: boolean) => void; onCreated?: (id: string) => void; remove?: (id: string) => void;
}) {
  const [draft, setDraft] = useState<PrepDoc>(() => existing ?? emptyPrep(kind));
  const [pending, setPending] = useState<{ id: string; updated: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [edited, setEdited] = useState(false);
  const environment = environments.find(entry => entry.id === draft.environmentId);
  const dirty = edited && JSON.stringify(draft) !== JSON.stringify(existing ?? emptyPrep(kind));
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
    if (new Blob([JSON.stringify(next)]).size > 60000) { setError('This preparation is too long to save. Shorten the notes or split them into separate scenarios.'); return; }
    setError('');
    const docId = id ?? `scenario:${crypto.randomUUID()}`;
    save(docId, next); setDraft(next); setPending({ id: docId, updated: next.updated });
    // Select only after the server echoes the created document (handled below by the observer).
  }
  return <form className="gm-editor" onSubmit={submit}>
    <header className="gm-section-heading"><h2>{kind === 'setting' ? 'Campaign setting' : id ? 'Scenario preparation' : 'New scenario'}</h2><span className="gm-muted">{kind === 'setting' ? 'One living reference for your world' : 'Plan situations and possible outcomes'}</span></header>
    <fieldset disabled={!!pending} className="gm-editor-fields">
    <label className="gm-field">{kind === 'setting' ? 'Setting name' : 'Scenario title'}<input required maxLength={200} value={draft.title} onChange={e => change({ title: e.target.value })} placeholder={kind === 'setting' ? 'Name your world or campaign frame' : 'Give this scenario a name'} /></label>
    {kind === 'scenario' && <div className="gm-form-row"><label className="gm-field">Status<select aria-label="Status" value={draft.status} onChange={e => change({ status: e.target.value as PrepDoc['status'] })}><option value="planned">Planned</option><option value="active">Active</option><option value="complete">Complete</option></select></label><label className="gm-field">Environment reference<select aria-label="Environment reference" value={draft.environmentId} onChange={e => change({ environmentId: e.target.value })}><option value="">No environment</option>{environments.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · Tier {entry.tier}</option>)}</select></label></div>}
    <div className="gm-fields">{(kind === 'setting' ? SETTING_FIELDS : SCENARIO_FIELDS).map(([key, label, placeholder]) => <label className="gm-field" key={key}>{label}<textarea rows={4} maxLength={6000} value={draft.fields[key] ?? ''} placeholder={placeholder} onChange={e => change({ fields: { ...draft.fields, [key]: e.target.value } })} /></label>)}</div>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {environment && <details className="gm-environment" open><summary>{environment.name} · Tier {environment.tier} · {environment.type}</summary><p>{environment.description}</p><p><strong>Difficulty {environment.difficulty}</strong> · {environment.impulses}</p><p><strong>Potential adversaries:</strong> {environment.potentialAdversaries}</p>{environment.features.map(feature => <section key={feature.name}><h3>{feature.name} <small>{feature.kind}</small></h3><p>{feature.text}</p>{('questions' in feature ? feature.questions : []).map(question => <p className="gm-muted" key={question}>{question}</p>)}</section>)}</details>}
    <footer className="gm-save-bar"><button className="daggery-primary" disabled={!connected || !!pending} type="submit"><Icon name="check" />{pending ? 'Saving…' : kind === 'setting' ? 'Save setting' : 'Save scenario'}</button><span role="status" className="gm-muted">{dirty ? 'Unsaved changes' : saved ? 'Saved' : existing ? 'Saved to this campaign' : ''}</span>{id && remove && <button className="daggery-roll-toggle gm-delete" type="button" disabled={!connected} onClick={() => { if (window.confirm(`Delete “${draft.title}”?`)) remove(id); }}><Icon name="trash" />Delete</button>}</footer>
    {!id && pending && <CreatedObserver id={pending.id} updated={pending.updated} onCreated={onCreated} />}
  </form>;
}

function CreatedObserver({ id, updated, onCreated }: { id: string; updated: string; onCreated?: (id: string) => void }) {
  const { items } = useDocs<GmDoc>('gm');
  useEffect(() => { if (items[id]?.updated === updated) onCreated?.(id); }, [items, id, updated, onCreated]);
  return null;
}

function Loot({ items, save, remove, connected }: { items: Record<string, GmDoc>; save: (id: string, doc: GmDoc) => void; remove: (id: string) => void; connected: boolean }) {
  const [table, setTable] = useState<LootTable>('items');
  const [lootSet, setLootSet] = useState<LootSet>('core');
  const [rarity, setRarity] = useState<keyof typeof RARITIES>('Common');
  const [count, setCount] = useState(1);
  const [result, setResult] = useState<ReturnType<typeof rollLoot> | null>(null);
  const [note, setNote] = useState('');
  const [keptId, setKeptId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const log = Object.entries(items).filter((entry): entry is [string, LootDoc] => entry[1].kind === 'loot').sort((a, b) => b[1].updated.localeCompare(a[1].updated));
  const entries = lootEntries(table, lootSet).filter(entry => `${entry.roll} ${entry.name} ${entry.description}`.toLowerCase().includes(search.toLowerCase()));
  useEffect(() => { if (!connected && keptId && !items[keptId]) setKeptId(null); }, [connected, keptId, items]);
  useEffect(() => { const handler = () => setKeptId(null); window.addEventListener('daggery:sync-error', handler); return () => window.removeEventListener('daggery:sync-error', handler); }, []);
  return <>
    <div className="gm-loot-layout"><section className="gm-panel"><header className="gm-section-heading"><h2>Roll for loot</h2><span className="gm-muted">Core Set + Additional · d12 pools</span></header>
      <div className="gm-form-row"><label className="gm-field">Table<select aria-label="Table" value={table} onChange={e => { setTable(e.target.value as LootTable); setSearch(''); }}><option value="items">Items</option><option value="consumables">Consumables</option></select></label><label className="gm-field">Source<select aria-label="Table source" value={lootSet} onChange={e => { setLootSet(e.target.value as LootSet); setSearch(''); }}><option value="core">Core Set</option><option value="additional">Additional (Hope &amp; Fear)</option></select></label><label className="gm-field">Rarity<select aria-label="Rarity" value={rarity} onChange={e => { const next = e.target.value as keyof typeof RARITIES; setRarity(next); setCount(RARITIES[next][0]); }}>{Object.keys(RARITIES).map(key => <option key={key}>{key}</option>)}</select></label><label className="gm-field">Dice pool<select aria-label="Dice pool" value={count} onChange={e => setCount(Number(e.target.value))}>{RARITIES[rarity].map(n => <option key={n} value={n}>{n}d12</option>)}</select></label></div>
      <button className="daggery-primary" onClick={() => { setResult(rollLoot(table, count, undefined, lootSet)); setKeptId(null); setNote(''); }}><Icon name="dice" />Roll {count}d12</button><p className="gm-muted gm-help">Rolls stay private. Keep a result to save it to your campaign.</p>
      {result && <div className="gm-loot-result" aria-live="polite"><p className="gm-kicker">{lootTableName(result.table as LootTable, result.set as LootSet)} · {result.dice.join(' + ')} = {result.total}</p><h3>{result.name}</h3><p>{result.description}</p><label className="gm-field">Recipient / notes<input maxLength={500} value={note} disabled={!!keptId} onChange={e => setNote(e.target.value)} placeholder="Who gets it? Where was it found?" /></label><button className="daggery-roll-toggle" disabled={!connected || !!keptId} onClick={() => { const id = `loot:${crypto.randomUUID()}`; save(id, { ...result, kind: 'loot', note, updated: new Date().toISOString() }); setKeptId(id); }}><Icon name="plus" />{keptId ? items[keptId] ? 'Kept in loot log' : 'Saving…' : 'Keep result'}</button></div>}
    </section><section className="gm-panel"><header className="gm-section-heading"><h2>Loot log</h2><span className="gm-muted">{log.length} kept</span></header>{log.length === 0 ? <p className="gm-empty">Keep rolled results here to track rewards between sessions.</p> : <ol className="gm-loot-log">{log.map(([id, entry]) => <li key={id}><div><strong>{entry.name}</strong><small>{lootTableName(entry.table as LootTable, (entry.set ?? 'core') as LootSet)} · Roll {entry.total}</small>{entry.note && <p>{entry.note}</p>}<details><summary>Item details</summary><p>{entry.description}</p></details></div><button className="gm-icon-button" disabled={!connected} aria-label={`Remove ${entry.name}`} onClick={() => { if (window.confirm(`Remove “${entry.name}” from the loot log?`)) remove(id); }}><Icon name="trash" /></button></li>)}</ol>}</section></div>
    <section className="gm-panel gm-table-panel"><header className="gm-section-heading"><h2>{lootTableName(table, lootSet)}</h2><span className="gm-muted">{entries.length} entries</span></header><label className="gm-field">Search table<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, effect, or roll number" /></label><div className="gm-table-scroll"><table><thead><tr><th scope="col">Roll</th><th scope="col">{table === 'items' ? 'Item' : 'Consumable'}</th><th scope="col">Effect</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td>{String(entry.roll).padStart(2, '0')}</td><th scope="row">{entry.name}</th><td>{entry.description}</td></tr>)}</tbody></table></div>{entries.length === 0 && <p className="gm-empty">No entries match your search.</p>}<p className="gm-muted gm-help">Daggerheart Core Rulebook and Hope &amp; Fear · <a href="https://www.daggerheart.com/srd/" target="_blank" rel="noreferrer">System Reference Document</a></p></section>
  </>;
}


