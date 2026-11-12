import { useEffect, useMemo, useRef, useState } from 'react';
import {
  chaosCheckModifier, EVENT_FOCUS_REASONS, eventFocusTable, fateCellRanges, fateChartCell, getRuleset, hasFeature, listSectionDie,
  MYTHIC_CHAOS_FLAVORS, MYTHIC_MEANING_CHOICES, MYTHIC_ODDS, MYTHIC_QUESTION_PURPOSES, PLAYER_VS_PC_KNOWLEDGE, rollDice,
  SOLO_KEYED_SCENE_LIMIT, SOLO_TRACKER_LIMIT, THREAD_TRACK_LENGTHS,
  type DiceRoll, type MythicAnswer, type MythicChaosFlavor, type MythicData, type MythicList, type MythicRange, type MythicTable,
  type MythicTableEntry, type MythicTablesFile, type SoloEntry, type SoloEntryPage, type SoloKeyedScene, type SoloSnapshot,
  type SoloState, type SoloTrackerItem,
} from '@daggery/shared';
import type { Sheet } from '@daggery/shared/daggerheart/types';
import { armorScore, hpMax, stressMax } from '@daggery/shared/daggerheart';
import { api } from '../../api';
import { useDocs } from '../../sync/store';
import { changeResourceCount } from '../sheets/resource-track';
import { getActiveCampaign } from '../../campaign-context';
import { Icon } from '../../components/Icon';
import { useDiceTray } from '../../dice3d';
import './solo.css';

type Tab = 'scene' | 'oracle' | 'tables' | 'dice' | 'notes';
type Track = (patch: Record<string, unknown>) => Promise<boolean>;
type MythicSource = 'adventureCrafter' | 'locationCrafting' | 'collectedTables';
type Roll = (kind: string, values: Record<string, unknown>) => Promise<SoloEntry | null>;
/** What every tab needs to roll on the server and keep a result. */
interface Play {
  entries: SoloEntry[]; busy: boolean; roll: Roll; accept: (id: string, interpretation: string) => Promise<boolean>;
  state: SoloState | null; chaos: number; flavor: MythicChaosFlavor; track: Track;
  /** Runs a bookkeeping step on the server: end of scene, thread track, peril points. */
  command: (values: Record<string, unknown>) => Promise<boolean>;
  /** Ids of the Mythic tables that have data installed. */
  installed: Set<string>;
}
const ANSWER_KEYS: Record<string, MythicAnswer> = { 'Exceptional Yes': 'exceptionalYes', Yes: 'yes', No: 'no', 'Exceptional No': 'exceptionalNo' };
const inRange = (range: MythicRange | undefined, value: number | undefined) => !!range && value !== undefined && value >= range[0] && value <= range[1];
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not complete the action.';
const root = () => `/api/campaigns/${encodeURIComponent(getActiveCampaign().id)}/solo`;
const CHAOS_KEY = 'daggery:chaos';
const CHAOS_DEFAULT = 5, CHAOS_MIN = 1, CHAOS_MAX = 9;
const RANGE_COLUMNS = [
  { key: 'exceptionalYes', label: 'Exceptional Yes', short: 'Exc. Yes' },
  { key: 'yes', label: 'Yes', short: 'Yes' },
  { key: 'no', label: 'No', short: 'No' },
  { key: 'exceptionalNo', label: 'Exceptional No', short: 'Exc. No' },
] as const;
const TABLE_GROUPS: { source: MythicSource; label: string }[] = [
  { source: 'adventureCrafter', label: 'Adventure Crafter' },
  { source: 'locationCrafting', label: 'Location Crafting' },
  { source: 'collectedTables', label: 'Collected Tables' },
];
const KIND_LABELS: Record<string, string> = {
  'mythic-scene': 'Scene test', 'mythic-oracle': 'Fate Question', 'mythic-meaning': 'Meaning', 'mythic-table': 'Table', 'mythic-event': 'Random Event',
  'mythic-adjust': 'Scene adjustment', 'mythic-list': 'List roll', 'mythic-discovery': 'Discovery Check', 'mythic-turning-point': 'Turning Point',
  'mythic-four-w': 'First scene', journal: 'Note', procedure: 'Procedure',
};
const ADVENTURE_THEMES = ['Action', 'Tension', 'Mystery', 'Social', 'Personal'];
const ODDS_TOP_DOWN = [...MYTHIC_ODDS].reverse();
const signed = (value: number) => (value === 0 ? 'none' : value > 0 ? `+${value}` : `−${Math.abs(value)}`);

const readChaos = () => {
  try {
    const stored = Number(localStorage.getItem(CHAOS_KEY));
    return Number.isInteger(stored) && stored >= CHAOS_MIN && stored <= CHAOS_MAX ? stored : CHAOS_DEFAULT;
  } catch {
    return CHAOS_DEFAULT;
  }
};
const formatRange = (range?: MythicRange) => (range ? (range[0] === range[1] ? `${range[0]}` : `${range[0]}–${range[1]}`) : '—');
const chunk = <T,>(items: readonly T[], parts: number): T[][] => {
  if (items.length === 0) return [];
  const size = Math.ceil(items.length / parts);
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
};
/** Skip a collected table when the same id and entries already appear in Location Crafting. */
const withoutLocationDuplicates = (tables: MythicTable[], other: MythicTablesFile | null): MythicTable[] =>
  other
    ? tables.filter(table => !other.tables.some(candidate => candidate.id === table.id && JSON.stringify(candidate.entries) === JSON.stringify(table.entries)))
    : tables;
const meaningInstalled = (installed: Set<string>, choice: (typeof MYTHIC_MEANING_CHOICES)[number]) =>
  choice.tables.every(id => installed.has(id)) || (choice.group === 'core' && installed.has('discover-meaning'));

export default function SoloPlay({ author: _author }: { author: string }) {
  if (!hasFeature(getActiveCampaign().configuration, 'daggerheart.solo') || getActiveCampaign().role !== 'gm') return <p>Solo play is not enabled for this campaign.</p>;
  return <Workspace />;
}

function Workspace() {
  const campaign = getActiveCampaign();
  const [tab, setTab] = useState<Tab>('scene');
  const [state, setState] = useState<SoloState | null>(null);
  const [entries, setEntries] = useState<SoloEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [mythic, setMythic] = useState<MythicData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [snapshot, tables] = await Promise.all([api<SoloSnapshot>(root()), api<MythicData>('/api/mythic')]);
        if (cancelled) return;
        setState(snapshot.state);
        setEntries(snapshot.entries);
        setNextCursor(snapshot.nextCursor);
        setMythic(tables);
      } catch (value) {
        if (!cancelled) setError(errorMessage(value));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function roll(kind: string, values: Record<string, unknown>): Promise<SoloEntry | null> {
    setBusy(true); setError(''); setNotice('');
    try {
      // Some rolls move the state too (a discovery marks the thread track), so the reply carries it.
      const { entry, state: next } = await api<{ entry: SoloEntry; state?: SoloState }>(`${root()}/roll`, 'POST', { kind, requestId: crypto.randomUUID(), ...values });
      setEntries(previous => [entry, ...previous.filter(item => item.id !== entry.id)]);
      if (next) setState(next);
      return entry;
    } catch (value) {
      setError(errorMessage(value));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function older() {
    if (!nextCursor) return;
    setBusy(true); setError('');
    try {
      const page = await api<SoloEntryPage>(`${root()}/entries?before=${encodeURIComponent(nextCursor)}`);
      setEntries(previous => [...previous, ...page.entries.filter(entry => !previous.some(old => old.id === entry.id))]);
      setNextCursor(page.nextCursor);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  async function accept(id: string, interpretation: string): Promise<boolean> {
    setBusy(true); setError('');
    try {
      const { entry } = await api<{ entry: SoloEntry }>(`${root()}/entries/${encodeURIComponent(id)}`, 'PUT', { interpretation });
      setEntries(previous => previous.map(item => (item.id === entry.id ? entry : item)));
      return true;
    } catch (value) {
      setError(errorMessage(value));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Saves part of the tracked state: chaos, scene, lists, keyed scenes or settings. */
  async function track(patch: Record<string, unknown>): Promise<boolean> {
    if (!state) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      const { state: next } = await api<{ state: SoloState }>(`${root()}/tracker`, 'PUT', { revision: state.revision, ...patch });
      setState(next);
      return true;
    } catch (value) {
      setError(errorMessage(value));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function command(values: Record<string, unknown>): Promise<boolean> {
    if (!state) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      const done = await api<{ state: SoloState; detail: string }>(`${root()}/command`, 'POST', { revision: state.revision, ...values });
      setState(done.state);
      setNotice(done.detail);
      // The step is also written to the notes: reload them so it shows there.
      const snapshot = await api<SoloSnapshot>(root());
      setEntries(snapshot.entries);
      setNextCursor(snapshot.nextCursor);
      return true;
    } catch (value) {
      setError(errorMessage(value));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const installed = useMemo(() => {
    const ids = new Set<string>();
    for (const file of [mythic?.oracle, mythic?.collectedTables, mythic?.adventureCrafter, mythic?.locationCrafting]) for (const table of file?.tables ?? []) ids.add(table.id);
    return ids;
  }, [mythic]);
  // Campaigns that never saved a chaos factor start from the one this browser remembered.
  const chaos = state?.chaos ?? readChaos();
  const play: Play = { entries, busy, roll, accept, state, chaos, flavor: state?.chaosFlavor ?? 'standard', track, command, installed };
  const openSheet = () => window.dispatchEvent(new CustomEvent('daggery:navigate', { detail: 'sheets' }));

  return <div className="solo-workspace">
    <header className="solo-heading">
      <div>
        <p className="solo-kicker">{getRuleset(campaign.configuration)?.name} · Solo</p>
        <h1><Icon name="spark" />Solo play</h1>
        <p>Ask the oracle, roll on the tables, and keep what becomes true.</p>
      </div>
      <button type="button" className="daggery-primary solo-sheet-link" onClick={openSheet}><Icon name="sheet" />Open character sheet</button>
    </header>
    <HeroStrip />
    <nav className="solo-tabs" aria-label="Solo sections">
      {([['scene', 'Scene'], ['oracle', 'Oracle'], ['tables', 'Tables'], ['dice', 'Dice'], ['notes', 'Notes']] as [Tab, string][]).map(([id, label]) =>
        <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    {error && <p role="alert" className="solo-alert">{error}</p>}
    {notice && <p role="status" className="solo-notice"><Icon name="check" />{notice}</p>}
    {tab === 'scene' && (state ? <SceneTab mythic={mythic} play={play} /> : !error && <p className="solo-empty">Loading your scene…</p>)}
    {tab === 'oracle' && <OracleTab mythic={mythic} play={play} />}
    {tab === 'tables' && <TablesTab mythic={mythic} play={play} />}
    {tab === 'dice' && <DiceTab play={play} />}
    {tab === 'notes' && <NotesTab play={play} nextCursor={nextCursor} older={older} />}
  </div>;
}

/** The hero's resources, so marking HP or spending Hope does not mean leaving the oracle. */
function HeroStrip() {
  const { items, set } = useDocs<Sheet>('sheets');
  const heroes = Object.values(items);
  const [heroId, setHeroId] = useState('');
  // Two quick clicks must not write from the same stale sheet, or the second undoes the first.
  const latest = useRef(items);
  useEffect(() => { latest.current = items; }, [items]);
  const hero = items[heroId] ?? heroes[0];
  if (!hero) return null;
  const change = (field: 'hpMarked' | 'stressMarked' | 'hope' | 'armorSlotsMarked', delta: number, max: number) => {
    const current = latest.current[hero.id] ?? hero;
    const next = { ...current, [field]: changeResourceCount(current[field], current[field] + delta, max), updatedAt: new Date().toISOString() };
    latest.current = { ...latest.current, [hero.id]: next };
    set(hero.id, next);
  };
  const tracks = [
    { field: 'hpMarked', label: 'HP', hint: 'marked', max: hpMax(hero) },
    { field: 'stressMarked', label: 'Stress', hint: 'marked', max: stressMax(hero) },
    { field: 'hope', label: 'Hope', hint: 'available', max: 6 },
    { field: 'armorSlotsMarked', label: 'Armor', hint: 'marked', max: armorScore(hero) },
  ] as const;
  return <section className="solo-hero" aria-label="Your hero">
    {heroes.length > 1
      ? <select aria-label="Hero" value={hero.id} onChange={event => setHeroId(event.target.value)}>{heroes.map(sheet => <option key={sheet.id} value={sheet.id}>{sheet.name}</option>)}</select>
      : <strong className="solo-hero-name">{hero.name}</strong>}
    <div className="solo-hero-tracks">
      {tracks.map(({ field, label, hint, max }) => {
        const value = hero[field];
        return <div className="solo-hero-track" key={field} role="group" aria-label={label}>
          <span>{label}<small>{hint}</small></span>
          <button type="button" aria-label={`Decrease ${label}`} disabled={value <= 0} onClick={() => change(field, -1, max)}>−</button>
          <b>{value}<i> / {max}</i></b>
          <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => change(field, 1, max)}>+</button>
        </div>;
      })}
    </div>
  </section>;
}

/** Remembers the last result a panel rolled, so it can show it under its button. */
function useRolled(play: Play) {
  const [id, setId] = useState<string | null>(null);
  const entry = id ? play.entries.find(item => item.id === id) : undefined;
  const run = async (kind: string, values: Record<string, unknown> = {}) => {
    const rolled = await play.roll(kind, values);
    if (rolled) setId(rolled.id);
    return rolled;
  };
  return [entry, run] as const;
}

function ChaosPanel({ play, settings }: { play: Play; settings?: boolean }) {
  const { chaos, flavor } = play;
  const locked = play.busy || !play.state;
  const set = (value: number) => void play.track({ chaos: Math.min(CHAOS_MAX, Math.max(CHAOS_MIN, Math.round(value))) });
  return <section className="solo-panel solo-chaos-panel" aria-label="Chaos factor">
    <div className="solo-row">
      <div className="solo-chaos-stepper" role="group" aria-label="Chaos factor">
        <button type="button" aria-label="Decrease chaos" disabled={locked || chaos <= CHAOS_MIN} onClick={() => set(chaos - 1)}>−</button>
        <span className="solo-chaos-value" aria-live="polite">Chaos <strong>{chaos}</strong></span>
        <button type="button" aria-label="Increase chaos" disabled={locked || chaos >= CHAOS_MAX} onClick={() => set(chaos + 1)}>+</button>
      </div>
      {settings && <>
        <label className="solo-field solo-inline-field">Chaos flavor<select value={flavor} disabled={locked} onChange={event => void play.track({ chaosFlavor: event.target.value })}>
          {MYTHIC_CHAOS_FLAVORS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <label className="solo-check"><input type="checkbox" checked={!!play.state?.preparedAdventure} disabled={locked} onChange={event => void play.track({ preparedAdventure: event.target.checked })} />Prepared adventure</label>
      </>}
    </div>
    <p className="solo-chaos-caption">{flavor === 'one-page'
      ? 'One-Page Mythic: answers ignore the chaos factor and any double is a Random Event.'
      : 'Starts at 5. Ending a scene you mostly controlled lowers it by 1; one that got away from you raises it by 1.'}</p>
  </section>;
}

function SceneTab({ mythic, play }: { mythic: MythicData | null; play: Play }) {
  const state = play.state!;
  const scene = state.scene;
  const [title, setTitle] = useState(scene.title);
  const [expected, setExpected] = useState(scene.expected);
  const [tested, run] = useRolled(play);
  const [started, start] = useRolled(play);
  // Ending a scene clears it on the server: follow that here.
  useEffect(() => { setTitle(scene.title); setExpected(scene.expected); }, [scene.title, scene.expected]);
  const dirty = title.trim() !== scene.title || expected.trim() !== scene.expected;
  const saveScene = () => play.track({ scene: { title: title.trim(), expected: expected.trim() } });
  const ready = !!mythic?.available && !play.busy;
  const canTurn = play.installed.has('plot-points') && play.installed.has('adventure-themes');

  async function testScene(values: Record<string, unknown> = {}) {
    if (dirty && !(await saveScene())) return;
    await run('mythic-scene', { question: title.trim(), ...values });
  }

  return <div className="solo-stack">
    <ChaosPanel play={play} settings />
    <section className="solo-panel">
      <form onSubmit={event => { event.preventDefault(); void saveScene(); }}>
      <h2>Current scene {state.sceneNumber ? <span className="solo-chip">Scene {state.sceneNumber + 1}</span> : null}</h2>
      <p className="solo-muted">Say where you are and what you expect to happen, then test whether the scene goes that way.</p>
      <label className="solo-field">Scene<input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="The eastern gate at dusk" /></label>
      <label className="solo-field">What you expect<textarea rows={2} maxLength={2000} value={expected} onChange={event => setExpected(event.target.value)} placeholder="The keeper lets me through without questions." /></label>
      <div className="solo-actions">
        <button className="daggery-roll-toggle" disabled={play.busy || !dirty}><Icon name="check" />{dirty ? 'Save scene' : 'Scene saved'}</button>
        <button type="button" className="daggery-primary" disabled={!ready} onClick={() => void testScene()}><Icon name="dice" />Test the scene</button>
        <button type="button" className="daggery-roll-toggle" disabled={!ready} onClick={() => void testScene({ auto: 'interrupt' })}>Start as an Interrupt</button>
        <button type="button" className="daggery-roll-toggle" disabled={!ready} onClick={() => void run('mythic-adjust', {})}>Scene adjustment</button>
      </div>
      {mythic && !mythic.available && <p className="solo-muted">The scene test needs the oracle tables, which are not installed.</p>}
      </form>
      <div aria-live="polite">{tested && <ResultCard key={tested.id} entry={tested} play={play} />}</div>
      <h3 className="solo-subhead">End the scene</h3>
      <p className="solo-muted">Update the lists below first, then say who held the scene.</p>
      <div className="solo-actions">
        <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void play.command({ command: 'end-scene', control: 'in' })}>I was in control (Chaos −1)</button>
        <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void play.command({ command: 'end-scene', control: 'out' })}>I was not in control (Chaos +1)</button>
        <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void play.command({ command: 'end-scene', control: 'same' })}>Leave chaos as it is</button>
      </div>
    </section>

    <section className="solo-panel">
      <h2>Start a scene from nothing</h2>
      <p className="solo-muted">For a first scene, or when you want the adventure to surprise you.</p>
      <div className="solo-actions">
        <button type="button" className="daggery-roll-toggle" disabled={!ready} onClick={() => void start('mythic-event', {})}><Icon name="dice" />Random Event</button>
        <button type="button" className="daggery-roll-toggle" disabled={!ready} onClick={() => void start('mythic-four-w', {})}><Icon name="dice" />Who, what, where, why</button>
        <label className="solo-field solo-inline-field">Adventure theme<select value={state.adventureTheme ?? ''} disabled={play.busy} onChange={event => void play.track({ adventureTheme: event.target.value })}>
          <option value="">Roll it</option>
          {ADVENTURE_THEMES.map(theme => <option key={theme} value={theme}>{theme}</option>)}
        </select></label>
        <button type="button" className="daggery-roll-toggle" disabled={!ready || !canTurn} onClick={() => void start('mythic-turning-point', {})}><Icon name="dice" />Turning Point</button>
      </div>
      <div aria-live="polite">{started && <ResultCard key={started.id} entry={started} play={play} />}</div>
    </section>

    <div className="solo-lists">
      <TrackerList title="Threads" field="threads" empty="No open threads. Add the goals and loose ends you are following." placeholder="Find the missing caravan" play={play} ready={ready} />
      <TrackerList title="Characters" field="characters" empty="No one yet. Add the people and creatures who matter." placeholder="The gate keeper" play={play} ready={ready} />
      {state.preparedAdventure && <TrackerList title="Adventure features" field="features" empty="Nothing yet. Add what is special about the prepared adventure: places, hazards, set pieces." placeholder="The flooded lower halls" play={play} ready={ready} />}
    </div>

    <ThreadTrackPanel play={play} ready={ready} />
    <KeyedScenesPanel play={play} />
    <PerilPanel play={play} />
  </div>;
}

function TrackerList({ title, field, empty, placeholder, play, ready }: { title: string; field: MythicList; empty: string; placeholder: string; play: Play; ready: boolean }) {
  const items: SoloTrackerItem[] = play.state?.[field] ?? [];
  const [name, setName] = useState('');
  const [rolled, run] = useRolled(play);
  const open = items.filter(item => !item.done);
  const full = open.length >= SOLO_TRACKER_LIMIT || items.length >= SOLO_TRACKER_LIMIT;
  const save = (next: SoloTrackerItem[]) => play.track({ [field]: next });
  const copies = (item: SoloTrackerItem) => open.filter(other => other.name.toLowerCase() === item.name.toLowerCase()).length;
  const die = listSectionDie(open.length);
  let line = 0;

  async function add() {
    if (await save([...items, { id: crypto.randomUUID(), name: name.trim(), note: '', done: false }])) setName('');
  }

  return <section className="solo-panel solo-tracker">
    <h2>{title} <span className="solo-chip">{open.length} of {SOLO_TRACKER_LIMIT} lines</span></h2>
    {items.length === 0
      ? <p className="solo-empty">{empty}</p>
      : <ul className="solo-tracker-list">{items.map(item => <li key={item.id} className={item.done ? 'is-done' : undefined}>
        <label><input type="checkbox" checked={item.done} disabled={play.busy} onChange={event => void save(items.map(other => other.id === item.id ? { ...other, done: event.target.checked } : other))} /><span><i className="solo-line-number">{item.done ? '·' : ++line}</i>{item.name}</span></label>
        {!item.done && <button type="button" aria-label={`Add ${item.name} on another line`} title="Important again: add another line (up to three)" disabled={play.busy || full || copies(item) >= 3} onClick={() => void save([...items, { id: crypto.randomUUID(), name: item.name, note: '', done: false }])}><Icon name="plus" /></button>}
        <button type="button" aria-label={`Remove ${item.name}`} disabled={play.busy} onClick={() => void save(items.filter(other => other.id !== item.id))}><Icon name="trash" /></button>
      </li>)}</ul>}
    <form className="solo-tracker-add" onSubmit={event => { event.preventDefault(); void add(); }}>
      <label className="solo-field">Add to {title.toLowerCase()}<input value={name} maxLength={120} disabled={full} onChange={event => setName(event.target.value)} placeholder={placeholder} /></label>
      <button className="daggery-roll-toggle" disabled={play.busy || full || !name.trim()}><Icon name="plus" />Add</button>
    </form>
    {full && <p className="solo-muted">This list is full at {SOLO_TRACKER_LIMIT}. Remove one to add another.</p>}
    <div className="solo-actions">
      <button type="button" className="daggery-roll-toggle" disabled={!ready || open.length === 0} onClick={() => void run('mythic-list', { list: field })}><Icon name="dice" />Roll on this list ({die ? `d${die} + d10` : 'd10'})</button>
    </div>
    <div aria-live="polite">{rolled && <ResultCard key={rolled.id} entry={rolled} play={play} />}</div>
  </section>;
}

function ThreadTrackPanel({ play, ready }: { play: Play; ready: boolean }) {
  const state = play.state!;
  const track = state.threadTrack;
  const threads = (state.threads ?? []).filter(item => !item.done);
  const unique = threads.filter((item, index) => threads.findIndex(other => other.name === item.name) === index);
  const [threadId, setThreadId] = useState('');
  const [length, setLength] = useState<number>(10);
  const [odds, setOdds] = useState('fifty-fifty');
  const [rolled, run] = useRolled(play);
  const chosen = unique.find(item => item.id === threadId) ?? unique[0];

  if (!track) return <section className="solo-panel">
    <h2>Thread Progress Track</h2>
    <p className="solo-muted">Keeps the adventure on one thread. Progress and Flashpoints fill the track; the thread cannot be resolved before its Conclusion.</p>
    {unique.length === 0
      ? <p className="solo-empty">Add a thread first.</p>
      : <div className="solo-actions">
        <label className="solo-field solo-inline-field">Focus thread<select value={chosen?.id ?? ''} onChange={event => setThreadId(event.target.value)}>{unique.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="solo-field solo-inline-field">Length<select value={length} onChange={event => setLength(Number(event.target.value))}>{THREAD_TRACK_LENGTHS.map(value => <option key={value} value={value}>{value} points</option>)}</select></label>
        <button type="button" className="daggery-primary" disabled={play.busy || !chosen} onClick={() => void play.command({ command: 'thread-track-start', threadId: chosen!.id, length })}>Start the track</button>
      </div>}
  </section>;

  const boxes = Array.from({ length: track.length }, (_, index) => index + 1);
  return <section className="solo-panel">
    <h2>Thread Progress Track <span className="solo-chip">{track.points} of {track.length}</span></h2>
    <p className="solo-muted">Focus thread: <strong>{track.name}</strong>. Plot Armor: nothing resolves it before the Conclusion.</p>
    <ol className="solo-track-boxes" aria-label={`Progress ${track.points} of ${track.length}`}>
      {boxes.map(box => {
        const flash = box % 5 === 0 && box < track.length, end = box === track.length;
        return <li key={box} className={`${box <= track.points ? 'is-marked' : ''}${flash ? ' is-flash' : ''}${end ? ' is-end' : ''}`.trim() || undefined}>
          <b>{box}</b>{flash && <small>Flashpoint{track.flashpoints[box / 5 - 1] ? ' ✓' : ''}</small>}{end && <small>Conclusion</small>}
        </li>;
      })}
    </ol>
    {track.concluded
      ? <div className="solo-actions">
        <button type="button" className="daggery-primary" disabled={!ready} onClick={() => void run('mythic-event', { reason: 'conclusion' })}><Icon name="dice" />Generate the Conclusion</button>
        <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void play.command({ command: 'thread-track-clear' })}>Close the track</button>
      </div>
      : <>
        <div className="solo-actions">
          <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void play.command({ command: 'thread-track-progress' })}>Progress +2</button>
          <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void play.command({ command: 'thread-track-progress', flashpoint: true })}>Flashpoint +2</button>
          {track.pendingFlashpoints > 0 && <button type="button" className="daggery-primary" disabled={!ready} onClick={() => void run('mythic-event', { reason: 'flashpoint' })}><Icon name="dice" />Generate the Flashpoint ({track.pendingFlashpoints} due)</button>}
          <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void play.command({ command: 'thread-track-clear' })}>Abandon the track</button>
        </div>
        <h3 className="solo-subhead">Discovery Check</h3>
        <p className="solo-muted">Stalled and out of ideas? Have your character do something that could turn up a lead, then ask “Is something discovered?” The odds are never worse than 50/50.</p>
        <div className="solo-actions">
          <label className="solo-field solo-inline-field">Odds<select value={odds} onChange={event => setOdds(event.target.value)}>{ODDS_TOP_DOWN.slice(0, 5).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <button type="button" className="daggery-roll-toggle" disabled={!ready || track.discoveryBlocked} onClick={() => void run('mythic-discovery', { odds })}><Icon name="dice" />{track.discoveryBlocked ? 'Dead end until the next scene' : 'Discovery Check'}</button>
        </div>
      </>}
    <div aria-live="polite">{rolled && <ResultCard key={rolled.id} entry={rolled} play={play} />}</div>
  </section>;
}

function KeyedScenesPanel({ play }: { play: Play }) {
  const scenes: SoloKeyedScene[] = play.state?.keyedScenes ?? [];
  const [trigger, setTrigger] = useState('');
  const [event, setEvent] = useState('');
  const save = (next: SoloKeyedScene[]) => play.track({ keyedScenes: next });
  const patch = (id: string, change: Partial<SoloKeyedScene>) => void save(scenes.map(item => (item.id === id ? { ...item, ...change } : item)));
  const full = scenes.length >= SOLO_KEYED_SCENE_LIMIT;

  async function add() {
    if (await save([...scenes, { id: crypto.randomUUID(), trigger: trigger.trim(), event: event.trim(), triggered: false, done: false }])) { setTrigger(''); setEvent(''); }
  }

  return <section className="solo-panel">
    <h2>Keyed scenes</h2>
    <p className="solo-muted">Decide ahead what sets something off, and what happens. When the trigger occurs, the event opens the next scene.</p>
    {scenes.length > 0 && <ul className="solo-keyed-list">{scenes.map(item => <li key={item.id} className={item.done ? 'is-done' : undefined}>
      <div><strong>When:</strong> {item.trigger}<br /><strong>Then:</strong> {item.event}</div>
      <div className="solo-actions">
        {!item.done && <label className="solo-check"><input type="checkbox" checked={item.triggered} disabled={play.busy} onChange={change => patch(item.id, { triggered: change.target.checked })} />Triggered</label>}
        {item.triggered && !item.done && <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => patch(item.id, { done: true })}>Played</button>}
        <button type="button" className="solo-icon-button" aria-label={`Remove keyed scene: ${item.trigger}`} disabled={play.busy} onClick={() => void save(scenes.filter(other => other.id !== item.id))}><Icon name="trash" /></button>
      </div>
    </li>)}</ul>}
    <form className="solo-ask" onSubmit={submit => { submit.preventDefault(); void add(); }}>
      <label className="solo-field">Trigger<input value={trigger} maxLength={500} disabled={full} onChange={change => setTrigger(change.target.value)} placeholder="The chaos factor reaches 8" /></label>
      <label className="solo-field">Event<input value={event} maxLength={500} disabled={full} onChange={change => setEvent(change.target.value)} placeholder="The cult makes its move on the town" /></label>
      <button className="daggery-roll-toggle" disabled={play.busy || full || !trigger.trim() || !event.trim()}><Icon name="plus" />Add keyed scene</button>
    </form>
  </section>;
}

function PerilPanel({ play }: { play: Play }) {
  const peril = play.state?.peril ?? { max: 2, current: 2, replenish: true };
  const save = (next: typeof peril) => void play.track({ peril: next });
  return <section className="solo-panel">
    <h2>Peril points <span className="solo-chip">{peril.current} of {peril.max}</span></h2>
    <p className="solo-muted">Spend one to turn aside an outcome that would end the adventure or an important storyline.</p>
    <div className="solo-actions">
      <button type="button" className="daggery-roll-toggle" disabled={play.busy || peril.current < 1} onClick={() => void play.command({ command: 'peril', action: 'spend' })}>Spend a Peril Point</button>
      <button type="button" className="daggery-roll-toggle" disabled={play.busy || !peril.replenish || peril.current >= peril.max} onClick={() => void play.command({ command: 'peril', action: 'reset' })}>New session: refill</button>
      <label className="solo-field solo-inline-field">You start with<select value={peril.max} disabled={play.busy} onChange={event => { const max = Number(event.target.value); save({ ...peril, max, current: Math.min(peril.current, max) }); }}>{[0, 1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="solo-check"><input type="checkbox" checked={peril.replenish} disabled={play.busy} onChange={event => save({ ...peril, replenish: event.target.checked })} />Refill each session</label>
    </div>
  </section>;
}

/** One rolled result. Until it is kept, it asks what the result means in the story. */
function ResultCard({ entry, play }: { entry: SoloEntry; play: Play }) {
  const [text, setText] = useState('');
  const asked = entry.question && entry.question !== entry.result.title ? entry.question : '';
  return <div className={`solo-result solo-tone-${entry.result.tone ?? 'neutral'}`}>
    <p className="solo-result-kind">{KIND_LABELS[entry.kind] ?? entry.kind}{asked ? ` · ${asked}` : ''}</p>
    <strong className="solo-result-title">{entry.result.title}</strong>
    {entry.result.detail && <p className="solo-result-detail">{entry.result.detail}</p>}
    {entry.accepted
      ? <p className="solo-interpretation"><Icon name="check" />{entry.interpretation}</p>
      : <form className="solo-result-keep" onSubmit={event => { event.preventDefault(); void play.accept(entry.id, text.trim()); }}>
        <label className="solo-field">What does this mean in your story?
          <textarea rows={2} maxLength={6000} value={text} onChange={event => setText(event.target.value)} placeholder="Write what becomes true." />
        </label>
        <button className="daggery-roll-toggle" disabled={play.busy || !text.trim()}><Icon name="check" />Keep in notes</button>
      </form>}
  </div>;
}

function NotInstalled() {
  return <section className="solo-panel solo-empty-state">
    <Icon name="book" />
    <h2>Oracle tables are not installed</h2>
    <p>Add the oracle table JSON files to the content folder to unlock the oracle reference.</p>
  </section>;
}

function OracleTab({ mythic, play }: { mythic: MythicData | null; play: Play }) {
  const { chaos, flavor } = play;
  const [question, setQuestion] = useState('');
  const [oddsId, setOddsId] = useState('fifty-fifty');
  const [method, setMethod] = useState('chart');
  const [purpose, setPurpose] = useState('question');
  const [asked, setAsked] = useState<{ id: string; oddsId: string } | null>(null);
  const [focus, setFocus] = useState('');
  const [eventMeaning, setEventMeaning] = useState('actions');
  const [choice, setChoice] = useState('actions');
  const [count, setCount] = useState(1);
  const [event, runEvent] = useRolled(play);
  const [meaning, runMeaning] = useRolled(play);

  const meaningRows = useMemo(
    () => mythic?.oracle?.tables.find(item => item.id === 'discover-meaning')?.entries ?? [],
    [mythic],
  );
  const meaningColumns = useMemo(() => chunk(meaningRows, 3), [meaningRows]);

  if (!mythic) return <p className="solo-empty">Loading oracle tables…</p>;
  if (!mythic.available) return <NotInstalled />;

  // A Fate Question that replaces a rule of the game always reads the Chaos 5 column.
  const chartChaos = purpose === 'rpg-rule' ? CHAOS_DEFAULT : chaos;
  const answer = asked ? play.entries.find(entry => entry.id === asked.id) : undefined;
  const prepared = !!play.state?.preparedAdventure;
  const counts = { threads: (play.state?.threads ?? []).filter(item => !item.done).length, characters: (play.state?.characters ?? []).filter(item => !item.done).length, features: (play.state?.features ?? []).filter(item => !item.done).length };
  const focusTable = eventFocusTable(prepared);
  const onePage = play.installed.has('discover-meaning');
  const missing = MYTHIC_MEANING_CHOICES.filter(item => !meaningInstalled(play.installed, item));
  const meaningOptions = (value: string, set: (next: string) => void, label: string) => <label className="solo-field">{label}<select value={value} onChange={change => set(change.target.value)}>
    <optgroup label="Core">{MYTHIC_MEANING_CHOICES.filter(item => item.group === 'core').map(item => <option key={item.id} value={item.id} disabled={!meaningInstalled(play.installed, item)}>{item.label}</option>)}</optgroup>
    {onePage && <optgroup label="One-Page (one word)"><option value="one-page-action">Discover Meaning: Action</option><option value="one-page-description">Discover Meaning: Description</option></optgroup>}
    <optgroup label="Elements">{MYTHIC_MEANING_CHOICES.filter(item => item.group === 'elements').map(item => <option key={item.id} value={item.id} disabled={!meaningInstalled(play.installed, item)}>{item.label}{meaningInstalled(play.installed, item) ? '' : ' (not installed)'}</option>)}</optgroup>
  </select></label>;

  async function ask() {
    const entry = await play.roll('mythic-oracle', { question: question.trim(), odds: oddsId, method, purpose });
    if (entry) { setAsked({ id: entry.id, oddsId }); setQuestion(''); }
  }

  return <div className="solo-stack">
    <ChaosPanel play={play} />

    <section className="solo-panel">
      <h2>Ask a Fate Question</h2>
      <p className="solo-muted">Ask a yes or no question, choose how likely a yes is, and roll. Follow your expectations first: ask only when the answer is uncertain or matters.</p>
      <form className="solo-ask" onSubmit={submit => { submit.preventDefault(); void ask(); }}>
        <label className="solo-field">Question<input value={question} maxLength={2000} onChange={change => setQuestion(change.target.value)} placeholder="Is the gate guarded?" /></label>
        <label className="solo-field">Odds<select aria-label="Odds" value={oddsId} onChange={change => setOddsId(change.target.value)}>{ODDS_TOP_DOWN.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
        <label className="solo-field">Roll with<select value={method} onChange={change => setMethod(change.target.value)}><option value="chart">Fate Chart (d100)</option><option value="check">Fate Check (2d10)</option></select></label>
        <label className="solo-field">Use it as<select value={purpose} onChange={change => setPurpose(change.target.value)}>{MYTHIC_QUESTION_PURPOSES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <button className="daggery-primary" disabled={play.busy || !question.trim()}><Icon name="dice" />Ask</button>
      </form>
      <div aria-live="polite">{answer && <ResultCard key={answer.id} entry={answer} play={play} />}</div>
      <div className="solo-reference-table solo-oracle-chart-wrap">
        <table className="solo-oracle-chart">
          <thead>
            <tr>
              <th scope="col">Odds</th>
              {method === 'check'
                ? <><th scope="col">Odds modifier</th><th scope="col">Chaos modifier</th><th scope="col">Yes on 2d10</th></>
                : RANGE_COLUMNS.map(column => <th scope="col" key={column.key}>
                  <span className="solo-col-full">{column.label}</span>
                  <span className="solo-col-short">{column.short}</span>
                </th>)}
            </tr>
          </thead>
          <tbody>
            {ODDS_TOP_DOWN.map(row => {
              const rolledHere = !!answer && asked?.oddsId === row.id;
              const rowClass = [row.id === 'fifty-fifty' ? 'is-mid' : '', rolledHere ? 'is-rolled' : ''].join(' ').trim() || undefined;
              if (method === 'check') {
                const chaosModifier = chaosCheckModifier(chartChaos, flavor);
                const need = 11 - row.check - chaosModifier;
                return <tr key={row.id} className={rowClass}>
                  <th scope="row">{row.label}</th>
                  <td className="solo-range">{signed(row.check)}</td>
                  <td className="solo-range">{signed(chaosModifier)}</td>
                  <td className="solo-range">{need <= 2 ? 'always' : need > 20 ? 'never' : `${need}+`}</td>
                </tr>;
              }
              const ranges = fateCellRanges(fateChartCell(row.id, chartChaos, flavor));
              return <tr key={row.id} className={rowClass}>
                <th scope="row">{row.label}</th>
                {RANGE_COLUMNS.map(column => {
                  const hit = rolledHere && ANSWER_KEYS[answer.result.title] === column.key;
                  return <td key={column.key} className={`solo-range${hit ? ' is-answer' : ''}`}>{formatRange(ranges[column.key])}</td>;
                })}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <p className="solo-shift-note">{method === 'check'
        ? 'Fate Check: 2d10 plus both modifiers. 11 or more is Yes, 18 or more Exceptional Yes, 4 or less Exceptional No. Matching dice within the chaos factor add a Random Event.'
        : flavor === 'one-page'
          ? 'One-Page Mythic: the chart never moves, and any double (11, 22, 33…) adds a Random Event.'
          : `Fate Chart column for Chaos ${chartChaos}. A double whose digit is ${chaos} or less (11 to ${chaos * 11}) adds a Random Event.`}</p>
    </section>

    <section className="solo-panel">
      <h2>Random Event</h2>
      <p className="solo-muted">Fate Questions and Interrupt scenes roll these for you. Roll one yourself here, or choose the focus that suits the moment.</p>
      <form className="solo-ask" onSubmit={submit => { submit.preventDefault(); void runEvent('mythic-event', { focus, meaning: eventMeaning }); }}>
        <label className="solo-field">Event focus<select value={focus} onChange={change => setFocus(change.target.value)}>
          <option value="">Roll d100</option>
          {focusTable.map(item => <option key={item.id} value={item.id} disabled={!!item.list && counts[item.list] === 0}>{item.label} ({formatRange(item.range)})</option>)}
        </select></label>
        {meaningOptions(eventMeaning, setEventMeaning, 'Meaning table')}
        <button className="daggery-primary" disabled={play.busy}><Icon name="dice" />Generate event</button>
      </form>
      {focus && <p className="solo-muted">{EVENT_FOCUS_REASONS[focus]}</p>}
      <div aria-live="polite">{event && <ResultCard key={event.id} entry={event} play={play} />}</div>
    </section>

    <section className="solo-panel">
      <h2>Discover meaning</h2>
      <p className="solo-muted">For details a yes or no cannot give. Pick the table that fits what you are describing and roll a word pair.</p>
      <form className="solo-ask" onSubmit={submit => { submit.preventDefault(); void runMeaning('mythic-meaning', { choice, count }); }}>
        {meaningOptions(choice, setChoice, 'Meaning table')}
        <label className="solo-field">Rolls<select value={count} onChange={change => setCount(Number(change.target.value))}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <button className="daggery-primary" disabled={play.busy}><Icon name="dice" />Roll meaning</button>
      </form>
      <div aria-live="polite">{meaning && <ResultCard key={meaning.id} entry={meaning} play={play} />}</div>
      {missing.length > 0 && <p className="solo-muted">{missing.length} of the {MYTHIC_MEANING_CHOICES.length} Meaning Tables have no data installed yet and are greyed out.</p>}
      {meaningRows.length > 0 && <details className="solo-table">
        <summary><span className="solo-table-title">One-Page Discover Meaning table</span><span className="solo-chip">d100</span></summary>
        <div className="solo-meaning-grid">
          {meaningColumns.map((group, groupIndex) => <MeaningTable key={groupIndex} rows={group} />)}
        </div>
        <div className="solo-meaning-single">
          <MeaningTable rows={meaningRows} />
        </div>
      </details>}
    </section>

    <section className="solo-panel">
      <h2>What you know and what your character knows</h2>
      <ul className="solo-guide-list">{PLAYER_VS_PC_KNOWLEDGE.map(item => <li key={item.strategy}><strong>{item.strategy}.</strong> {item.solution}</li>)}</ul>
    </section>
  </div>;
}

function MeaningTable({ rows, rolled }: { rows: MythicTableEntry[]; rolled?: number }) {
  return <div className="solo-reference-table">
    <table className="solo-meaning-table">
      <thead>
        <tr><th scope="col">Range</th><th scope="col">Action</th><th scope="col">Description</th></tr>
      </thead>
      <tbody>
        {rows.map((entry, index) => <tr key={entry.range?.join('-') ?? index} className={inRange(entry.range, rolled) ? 'is-rolled' : undefined}>
          <td className="solo-range">{formatRange(entry.range)}</td>
          <td>{entry.cells?.[0] ?? entry.text ?? '—'}</td>
          <td>{entry.cells?.[1] ?? ''}</td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}

function TablesTab({ mythic, play }: { mythic: MythicData | null; play: Play }) {
  const [filter, setFilter] = useState('');
  if (!mythic) return <p className="solo-empty">Loading oracle tables…</p>;
  if (!mythic.available) return <NotInstalled />;

  const groups = TABLE_GROUPS
    .map(group => {
      const file = mythic[group.source];
      if (!file || file.tables.length === 0) return null;
      const tables = group.source === 'collectedTables'
        ? withoutLocationDuplicates(file.tables, mythic.locationCrafting)
        : file.tables;
      return { ...group, tables };
    })
    .filter((group): group is { source: MythicSource; label: string; tables: MythicTable[] } => group !== null);

  if (groups.length === 0) return <p className="solo-empty">No reference tables are installed.</p>;

  const needle = filter.trim().toLowerCase();
  const shown = groups.map(group => ({ ...group, tables: group.tables.filter(table => table.title.toLowerCase().includes(needle)) })).filter(group => group.tables.length > 0);

  return <div className="solo-stack">
    <label className="solo-field solo-table-filter">Find a table<input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Table name" /></label>
    {shown.length === 0 && <p className="solo-empty">No tables match “{filter.trim()}”.</p>}
    {shown.map((group, groupIndex) => <section className="solo-tables-group" key={group.source} aria-labelledby={`solo-group-${group.source}`}>
      <h2 id={`solo-group-${group.source}`}>{group.label}</h2>
      <div className="solo-table-stack">
        {group.tables.map(table => <details className="solo-table" key={`${group.source}:${table.id}`} open={groupIndex === 0 || needle ? true : undefined}>
          <summary>
            <span className="solo-table-title">{table.title}</span>
            <span className="solo-chip">{table.die}</span>
          </summary>
          <TableRoller source={group.source} table={table} play={play} />
        </details>)}
      </div>
    </section>)}
  </div>;
}

/** Rolls the table on the server, shows the result, and marks the row it landed on. */
function TableRoller({ source, table, play }: { source: MythicSource; table: MythicTable; play: Play }) {
  const [rolledId, setRolledId] = useState<string | null>(null);
  const [column, setColumn] = useState('');
  const columns = table.columns && table.columns.length > 1 ? table.columns : [];
  const rolled = rolledId ? play.entries.find(entry => entry.id === rolledId) : undefined;

  async function rollTable() {
    const entry = await play.roll('mythic-table', { source, tableId: table.id, ...(column === '' ? {} : { column: Number(column) }) });
    if (entry) setRolledId(entry.id);
  }

  return <>
    <div className="solo-table-roll">
      {columns.length > 0 && <label className="solo-field">Read<select aria-label={`Column of ${table.title}`} value={column} onChange={event => setColumn(event.target.value)}>
        <option value="">The whole row</option>
        {columns.map((name, index) => <option key={`${name}-${index}`} value={index}>{name}</option>)}
      </select></label>}
      <button type="button" className="daggery-primary" disabled={play.busy} onClick={() => void rollTable()}><Icon name="dice" />Roll {table.die}</button>
    </div>
    <div aria-live="polite">{rolled && <ResultCard key={rolled.id} entry={rolled} play={play} />}</div>
    <TableBody table={table} rolled={rolled?.result.total} />
  </>;
}

function TableBody({ table, rolled }: { table: MythicTable; rolled?: number }) {
  const columns = table.columns && table.columns.length > 0 ? table.columns : null;
  return <div className="solo-reference-table solo-table-scroll">
    <table className="solo-lookup-table">
      <thead>
        <tr>
          <th scope="col">Roll</th>
          {columns ? columns.map((column, index) => <th scope="col" key={`${column}-${index}`}>{column}</th>) : <th scope="col">Result</th>}
        </tr>
      </thead>
      <tbody>
        {table.entries.map((entry: MythicTableEntry, index) => <tr key={entry.range?.join('-') ?? index} className={inRange(entry.range, rolled) ? 'is-rolled' : undefined}>
          <td className="solo-range">{formatRange(entry.range)}</td>
          {columns && entry.text !== undefined
            ? <td colSpan={columns.length}>{entry.text}{entry.unclear ? ' ?' : ''}</td>
            : columns
              ? columns.map((_, column) => <td key={column}>{entry.cells?.[column] ?? ''}</td>)
              : <td>{entry.text ?? entry.cells?.join(' · ') ?? ''}{entry.unclear ? ' ?' : ''}</td>}
        </tr>)}
      </tbody>
    </table>
  </div>;
}

function DiceTab({ play }: { play: Play }) {
  const { replay } = useDiceTray();
  const [notation, setNotation] = useState('1d20');
  const [result, setResult] = useState<DiceRoll | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function perform(value: string) {
    setError(''); setBusy(true);
    try {
      const rolled = rollDice(value);
      setResult(rolled);
      setSaved(false);
      await replay({ kind: 'dice', result: rolled }).catch(() => {});
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  return <div className="solo-stack">
    <section className="solo-panel">
      <h2>Roll dice</h2>
      <p className="solo-muted">Quick dice, or any notation such as 2d6+3.</p>
      <div className="solo-dice-buttons">{[4, 6, 8, 10, 12, 20, 100].map(sides =>
        <button type="button" className="solo-die-button" key={sides} disabled={busy} onClick={() => void perform(`1d${sides}`)}>d{sides}</button>)}
      </div>
      <form className="solo-dice-notation" onSubmit={event => { event.preventDefault(); void perform(notation); }}>
        <label className="solo-field">Notation<input value={notation} onChange={event => setNotation(event.target.value)} placeholder="2d6+3" /></label>
        <button className="daggery-primary" disabled={busy || !notation.trim()}><Icon name="dice" />Roll</button>
      </form>
      {error && <p role="alert" className="solo-alert">{error}</p>}
      {result && <div className="solo-dice-result">
        <span className="solo-dice-total">{result.total}</span>
        <span className="solo-muted">{result.notation} · {result.rolls.length ? result.rolls.join(', ') : 'no dice'}{result.modifier ? ` · modifier ${result.modifier}` : ''}</span>
        <button type="button" className="daggery-roll-toggle" disabled={play.busy || saved} onClick={async () => {
          const entry = await play.roll('journal', { question: `Rolled ${result.notation}: ${result.total}${result.rolls.length > 1 ? ` (${result.rolls.join(', ')})` : ''}` });
          if (entry) setSaved(true);
        }}><Icon name="check" />{saved ? 'Saved to notes' : 'Save to notes'}</button>
      </div>}
    </section>
  </div>;
}

function NotesTab({ play, nextCursor, older }: { play: Play; nextCursor: string | null; older: () => Promise<void> }) {
  const { entries, busy, roll } = play;
  const [note, setNote] = useState('');
  const [everything, setEverything] = useState(false);
  const accepted = entries.filter(entry => entry.accepted);
  const open = entries.length - accepted.length;
  const listed = everything ? entries : accepted;

  async function addNote() {
    const entry = await roll('journal', { question: note });
    if (entry) setNote('');
  }

  return <div className="solo-stack">
    <form className="solo-panel" onSubmit={event => { event.preventDefault(); void addNote(); }}>
      <h2>Add a note</h2>
      <p className="solo-muted">Record what changed, what became true, and what you will do next.</p>
      <label className="solo-field">Note
        <textarea rows={3} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder="The keeper agrees to meet at dusk." />
      </label>
      <button className="daggery-primary" disabled={busy || !note.trim()}><Icon name="check" />Save note</button>
    </form>
    <section className="solo-panel">
      <h2>Session notes</h2>
      <div className="solo-note-filter" role="group" aria-label="Notes shown">
        <button type="button" aria-pressed={!everything} onClick={() => setEverything(false)}>Kept ({accepted.length})</button>
        <button type="button" aria-pressed={everything} onClick={() => setEverything(true)}>Everything rolled ({entries.length})</button>
      </div>
      {listed.length === 0
        ? <p className="solo-empty">{everything ? 'Nothing rolled yet. Ask the oracle or roll on a table.' : open > 0 ? `Nothing kept yet. ${open} rolled ${open === 1 ? 'result is' : 'results are'} waiting under Everything rolled.` : 'Your notes and the results you keep appear here.'}</p>
        : <ul className="solo-note-list">{listed.map(entry => <li key={entry.id}>
          {entry.kind === 'journal' || entry.kind === 'procedure'
            ? <strong>{entry.interpretation || entry.question}</strong>
            : entry.accepted
              ? <>
                <strong>{entry.question && entry.question !== entry.result.title ? `${entry.question} — ${entry.result.title}` : entry.result.title}</strong>
                {entry.result.detail && <p className="solo-result-detail">{entry.result.detail}</p>}
                <p className="solo-interpretation">{entry.interpretation}</p>
              </>
              : <ResultCard entry={entry} play={play} />}
          <small>{KIND_LABELS[entry.kind] ?? entry.kind} · {new Date(entry.at).toLocaleString()}</small>
        </li>)}</ul>}
      {nextCursor && <button type="button" className="daggery-roll-toggle" disabled={busy} onClick={() => void older()}>Load older notes</button>}
    </section>
  </div>;
}
