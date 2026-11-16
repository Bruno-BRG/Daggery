import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { environments } from '@daggery/content';
import { getActiveCampaign } from '../../campaign-context';
import { Icon } from '../../components/Icon';
import { Group, IconButton, ItemCard, PanelSection, Row, SearchField, TONES } from '../../components/Accordion';
import { useDocs, useSyncStatus } from '../../sync/store';
import { lootEntries, lootTableName, RARITIES, rollLoot, SCENARIO_FIELDS, SETTING_FIELDS, type GmDoc, type LootDoc, type LootSet, type LootTable, type PrepDoc } from './model';
import './gm.css';

const emptyPrep = (kind: PrepDoc['kind']): PrepDoc => ({ kind, title: '', fields: {}, environmentId: '', status: 'planned', updated: '' });

export default function GmTools({ author: _author }: { author: string }) {
  if (getActiveCampaign().role !== 'gm') return <p>GM tools are available to the Game Master.</p>;
  return <Workspace />;
}

interface Dirty { setting: boolean; scenario: boolean }

function Workspace() {
  const docs = useDocs<GmDoc>('gm');
  const connected = useSyncStatus() === 'open';
  const [selected, setSelected] = useState('new');
  const [newKey, setNewKey] = useState(0);
  const [dirty, setDirty] = useState<Dirty>({ setting: false, scenario: false });
  const [settingOpen, setSettingOpen] = useState(false);
  const [scenariosOpen, setScenariosOpen] = useState(false);
  const scenarios = Object.entries(docs.items).filter((entry): entry is [string, PrepDoc] => entry[1].kind === 'scenario').sort((a, b) => b[1].updated.localeCompare(a[1].updated));
  const anyDirty = dirty.setting || dirty.scenario;
  const scenario = selected !== 'new' && docs.items[selected]?.kind === 'scenario' ? docs.items[selected] as PrepDoc : undefined;

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (anyDirty) event.preventDefault(); };
    const navigating = (event: Event) => { if (anyDirty && !window.confirm('Discard your unsaved GM preparation?')) event.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    window.addEventListener('daggery:before-navigate', navigating);
    return () => { window.removeEventListener('beforeunload', handler); window.removeEventListener('daggery:before-navigate', navigating); };
  }, [anyDirty]);

  const setSettingDirty = useCallback((value: boolean) => setDirty(current => current.setting === value ? current : { ...current, setting: value }), []);
  const setScenarioDirty = useCallback((value: boolean) => setDirty(current => current.scenario === value ? current : { ...current, scenario: value }), []);
  const leave = () => !dirty.scenario || window.confirm('Discard your unsaved changes?');

  function toggleSetting(open: boolean) {
    if (!open && dirty.setting && !window.confirm('Discard your unsaved setting?')) return;
    if (!open) setSettingDirty(false);
    setSettingOpen(open);
  }

  function toggleScenarios(open: boolean) {
    if (!open && dirty.scenario && !window.confirm('Discard your unsaved scenario?')) return;
    if (!open) setScenarioDirty(false);
    setScenariosOpen(open);
  }

  function chooseScenario(id: string) {
    if (id === selected || !leave()) return;
    setScenarioDirty(false);
    setSelected(id);
  }

  function startScenario() {
    if (!leave()) return;
    setScenariosOpen(true);
    setSelected('new');
    setNewKey(value => value + 1);
    setScenarioDirty(false);
  }

  function removeScenario(id: string) {
    docs.remove(id);
    setSelected('new');
    setScenarioDirty(false);
  }

  return <div className="sg-page gm-workspace gm-page">
    <header className="gm-heading"><div><p className="gm-kicker">Campaign preparation</p><h1><Icon name="compass" />GM tools</h1><p>Prepare the world. Keep what you need at the table.</p></div><span className="gm-private"><Icon name="lock" />GM only</span></header>
    {!connected && <p role="status" className="gm-notice">Connecting… Saving will be available when the campaign reconnects.</p>}
    <PanelSection id="gm-loot" title="Loot tables" storageKey="gm.loot">
      <Loot items={docs.items} save={docs.set} remove={docs.remove} connected={connected} />
    </PanelSection>
    <PanelSection id="gm-setting" title="Setting" open={settingOpen} onToggle={toggleSetting}>
      <Group title="Campaign setting" icon="tree" defaultOpen>
        <PrepEditor key="setting" id="setting" kind="setting" existing={docs.items.setting?.kind === 'setting' ? docs.items.setting : undefined} save={docs.set} connected={connected} onDirty={setSettingDirty} />
      </Group>
    </PanelSection>
    <PanelSection id="gm-scenarios" title="Scenarios" open={scenariosOpen} onToggle={toggleScenarios} actions={<IconButton icon="plus" tone="action" label="New scenario" onClick={startScenario} />}>
      <Group title="Saved scenarios" icon="scroll" count={scenarios.length} defaultOpen>
        {scenarios.length === 0
          ? <p className="sg-empty">No scenarios yet. Start with a hook, then add the stakes and scenes.</p>
          : scenarios.map(([id, entry]) => <Row key={id} current={selected === id}
            leading={<Icon name="scroll" />}
            label={entry.title}
            value={<span className="gm-status">{entry.status}</span>}
            action={<IconButton icon="arrow" label={`Open ${entry.title}`} onClick={() => chooseScenario(id)} />}
          />)}
      </Group>
      <Group title={selected === 'new' ? 'New scenario' : 'Scenario preparation'} icon="scroll" defaultOpen>
        <PrepEditor key={`${selected}-${newKey}`} id={selected === 'new' ? undefined : selected} kind="scenario" existing={selected !== 'new' && scenario ? scenario : undefined} save={docs.set} connected={connected} onDirty={setScenarioDirty} onCreated={setSelected} remove={removeScenario} />
      </Group>
    </PanelSection>
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
  return <form className="gm-prep" onSubmit={submit}>
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

  function roll() {
    setResult(rollLoot(table, count, undefined, lootSet));
    setKeptId(null);
    setNote('');
  }

  return <>
    <Group title="Roll for loot" icon="chest" defaultOpen>
      <div className="gm-form-row">
        <label className="gm-field">Table<select aria-label="Table" value={table} onChange={e => { setTable(e.target.value as LootTable); setSearch(''); }}><option value="items">Items</option><option value="consumables">Consumables</option></select></label>
        <label className="gm-field">Source<select aria-label="Table source" value={lootSet} onChange={e => { setLootSet(e.target.value as LootSet); setSearch(''); }}><option value="core">Core Set</option><option value="additional">Additional (Hope &amp; Fear)</option></select></label>
        <label className="gm-field">Rarity<select aria-label="Rarity" value={rarity} onChange={e => { const next = e.target.value as keyof typeof RARITIES; setRarity(next); setCount(RARITIES[next][0]); }}>{Object.keys(RARITIES).map(key => <option key={key}>{key}</option>)}</select></label>
        <label className="gm-field">Dice pool<select aria-label="Dice pool" value={count} onChange={e => setCount(Number(e.target.value))}>{RARITIES[rarity].map(n => <option key={n} value={n}>{n}d12</option>)}</select></label>
      </div>
      <Row
        label={result ? 'Last roll' : 'Loot roll'}
        value={result ? result.name : `Roll ${count}d12 · ${lootTableName(table, lootSet)}`}
        action={<IconButton icon="dice" tone="action" label={`Roll ${count}d12`} onClick={roll} />}
      />
      {result && <div className="gm-loot-result" aria-live="polite">
        <p className="gm-kicker">{lootTableName(result.table, result.set)} · {result.dice.join(' + ')} = {result.total}</p>
        <p>{result.description}</p>
        <label className="gm-field">Recipient / notes<input maxLength={500} value={note} disabled={!!keptId} onChange={e => setNote(e.target.value)} placeholder="Who gets it? Where was it found?" /></label>
        <button className="daggery-roll-toggle" disabled={!connected || !!keptId} onClick={() => { const id = `loot:${crypto.randomUUID()}`; save(id, { ...result, kind: 'loot', note, updated: new Date().toISOString() }); setKeptId(id); }}><Icon name="plus" />{keptId ? items[keptId] ? 'Kept in loot log' : 'Saving…' : 'Keep result'}</button>
      </div>}
      <p className="gm-help">Rolls stay private. Keep a result to save it to your campaign.</p>
    </Group>
    <Group title="Loot log" icon="chest" count={log.length} defaultOpen>
      {log.length === 0
        ? <p className="sg-empty">Keep rolled results here to track rewards between sessions.</p>
        : log.map(([id, entry]) => <ItemCard key={id}
          title={entry.name}
          caption={`${lootTableName(entry.table, entry.set)} · Roll ${entry.total}`}
          tone={TONES.gold}
          actions={<IconButton icon="trash" tone="danger" label={`Remove ${entry.name}`} disabled={!connected} onClick={() => { if (window.confirm(`Remove “${entry.name}” from the loot log?`)) remove(id); }} />}>
          {entry.note && <p>{entry.note}</p>}
          <p>{entry.description}</p>
        </ItemCard>)}
    </Group>
    <Group title={lootTableName(table, lootSet)} icon="grid" count={entries.length} defaultOpen>
      <SearchField value={search} onChange={setSearch} placeholder="Name, effect, or roll number" label="Search table" />
      {entries.length === 0
        ? <p className="sg-empty">No entries match your search.</p>
        : entries.map(entry => <Row key={entry.id} leading={<span className="gm-roll-number">{String(entry.roll).padStart(2, '0')}</span>} label={entry.name} value={entry.description} />)}
      <p className="gm-help">Daggerheart Core Rulebook and Hope &amp; Fear · <a href="https://www.daggerheart.com/srd/" target="_blank" rel="noreferrer">System Reference Document</a></p>
    </Group>
  </>;
}
