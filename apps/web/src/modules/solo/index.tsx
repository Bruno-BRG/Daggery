import { useEffect, useRef, useState } from 'react';
import {
  DUALITY_ENGINE_VERSION, DUALITY_LIKELIHOODS, DUALITY_MAX_FEAR, DUALITY_MEANING_CHOICES, DUALITY_MOVE_TRIGGERS, DUALITY_TABLE_GROUPS,
  DUALITY_TABLES, dualityTable, getRuleset, hasFeature, rollDice, SOLO_CLOCK_LIMIT, SOLO_TRACKER_LIMIT,
  type DiceRoll, type DualityList, type DualityTable, type SoloClock, type SoloEntry, type SoloEntryPage, type SoloSnapshot,
  type SoloState, type SoloTrackerItem,
} from '@daggery/shared';
import type { Sheet } from '@daggery/shared/daggerheart/types';
import { armorScore, hpMax, stressMax } from '@daggery/shared/daggerheart';
import { api } from '../../api';
import { addFear, useDocs } from '../../sync/store';
import { changeResourceCount } from '../sheets/resource-track';
import { getActiveCampaign } from '../../campaign-context';
import { Icon } from '../../components/Icon';
import { useDiceTray } from '../../dice3d';
import { diceModeFor, setDiceMode, type DiceMode } from './diceMode';
import './solo.css';

type Tab = 'play' | 'tables' | 'generators' | 'tracker' | 'dice' | 'notes';
type Track = (patch: Record<string, unknown>) => Promise<boolean>;
type Roll = (kind: string, values: Record<string, unknown>) => Promise<SoloEntry | null>;
/** What every tab needs to roll on the server and keep a result. */
interface Play {
  entries: SoloEntry[]; busy: boolean; roll: Roll; accept: (id: string, interpretation: string) => Promise<boolean>;
  state: SoloState | null; track: Track;
  /** The campaign Fear pool: the engine spends it; action rolls with Fear and the stepper add to it. */
  fear: number;
  /** Runs a bookkeeping step on the server, such as ending the scene. */
  command: (values: Record<string, unknown>) => Promise<boolean>;
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not complete the action.';
const validDie = (value: string, sides: number) => /^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= sides;
const root = () => `/api/campaigns/${encodeURIComponent(getActiveCampaign().id)}/solo`;
const KIND_LABELS: Record<string, string> = {
  'duality-scene': 'Set the scene', 'duality-oracle': 'Oracle', 'duality-meaning': 'Meaning', 'duality-table': 'Table', 'duality-event': 'Random Event',
  'duality-move': 'GM Move', 'duality-list': 'List roll', 'duality-fear-check': 'Fear Check', 'duality-adversary': 'Adversary', 'duality-npc': 'NPC',
  'duality-plot': 'Plot hook', 'duality-site': 'Site', 'duality-journey': 'Journey', 'duality-encounter': 'Encounter', journal: 'Note', procedure: 'Procedure',
};
const EVENT_FOCUS = dualityTable('event-focus').columns[0]!.entries;
/** Daggerheart tiers by level: 1, 2–4, 5–7, 8–10. */
const tierFor = (level: number) => level <= 1 ? 1 : level <= 4 ? 2 : level <= 7 ? 3 : 4;

export default function SoloPlay({ author: _author }: { author: string }) {
  if (!hasFeature(getActiveCampaign().configuration, 'daggerheart.solo') || getActiveCampaign().role !== 'gm') return <p>Solo play is not enabled for this campaign.</p>;
  return <Workspace />;
}

function Workspace() {
  const campaign = getActiveCampaign();
  const [tab, setTab] = useState<Tab>('play');
  const [state, setState] = useState<SoloState | null>(null);
  const [entries, setEntries] = useState<SoloEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const combat = useDocs<{ kind?: string; value?: number }>('combat');
  const pool = combat.items.fear;
  const fear = pool?.kind === 'fear' && typeof pool.value === 'number' ? Math.min(DUALITY_MAX_FEAR, Math.max(0, pool.value)) : 0;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await api<SoloSnapshot>(root());
        if (cancelled) return;
        setState(snapshot.state);
        setEntries(snapshot.entries);
        setNextCursor(snapshot.nextCursor);
      } catch (value) {
        if (!cancelled) setError(errorMessage(value));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function roll(kind: string, values: Record<string, unknown>): Promise<SoloEntry | null> {
    setBusy(true); setError(''); setNotice('');
    try {
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

  /** Saves part of the tracked state: the scene, the lists or the countdowns. */
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

  const play: Play = { entries, busy, roll, accept, state, track, command, fear };
  const openSheet = () => window.dispatchEvent(new CustomEvent('daggery:navigate', { detail: 'sheets' }));
  const tabs: [Tab, string][] = [['play', 'Play'], ['tables', 'All tables'], ['generators', 'Generators'], ['tracker', 'Threads & NPCs'], ['dice', 'Dice'], ['notes', 'Notes']];

  return <div className="solo-workspace">
    <header className="solo-heading">
      <div>
        <p className="solo-kicker">{getRuleset(campaign.configuration)?.name} · Duality Solo Engine {DUALITY_ENGINE_VERSION}</p>
        <h1><Icon name="spark" />Solo play</h1>
      </div>
      <button type="button" className="daggery-roll-toggle solo-sheet-link" onClick={openSheet}><Icon name="sheet" />Character sheet</button>
    </header>
    <HeroStrip />
    <FearPanel play={play} />
    <nav className="solo-tabs" aria-label="Solo sections">
      {tabs.map(([id, label]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    {error && <p role="alert" className="solo-alert">{error}</p>}
    {notice && <p role="status" className="solo-notice"><Icon name="check" />{notice}</p>}
    {tab === 'play' && <PlayTab play={play} />}
    {tab === 'tables' && <TablesTab play={play} />}
    {tab === 'generators' && <GeneratorsTab play={play} />}
    {tab === 'tracker' && (state ? <TrackerTab play={play} /> : !error && <p className="solo-empty">Loading your lists…</p>)}
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

/** The Fear pool and the one check the whole engine runs on. */
function FearPanel({ play }: { play: Play }) {
  const { fear } = play;
  const [checked, run] = useRolled(play);
  return <section className="solo-panel solo-fear-panel" aria-label="Fear">
    <div className="solo-row">
      <div className="solo-fear-stepper" role="group" aria-label="Fear">
        <button type="button" aria-label="Decrease Fear" disabled={fear <= 0} onClick={() => addFear(-1)}>−</button>
        <span className="solo-fear-value" aria-live="polite">Fear <strong>{fear}</strong><i> / {DUALITY_MAX_FEAR}</i></span>
        <button type="button" aria-label="Increase Fear" disabled={fear >= DUALITY_MAX_FEAR} onClick={() => addFear(1)}>+</button>
      </div>
      <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void run('duality-fear-check')}><Icon name="dice" />Fear Check</button>
    </div>
    <p className="solo-fear-caption">Rolls with Fear from your sheet add to it; add Fear by hand when you rest. A Fear Check passes on a d12 at or under this number ({Math.round(fear / 12 * 100)}% now); the engine spends Fear itself when it acts.</p>
    <div aria-live="polite">{checked && <ResultCard key={checked.id} entry={checked} play={play} />}</div>
  </section>;
}

/** Optional bookkeeping: the current scene's name, the Threads and NPCs lists, and countdowns. */
function TrackerTab({ play }: { play: Play }) {
  const state = play.state!;
  const scene = state.scene;
  const [title, setTitle] = useState(scene.title);
  const [expected, setExpected] = useState(scene.expected);
  // Ending a scene clears it on the server: follow that here.
  useEffect(() => { setTitle(scene.title); setExpected(scene.expected); }, [scene.title, scene.expected]);
  const dirty = title.trim() !== scene.title || expected.trim() !== scene.expected;
  const saveScene = () => play.track({ scene: { title: title.trim(), expected: expected.trim() } });

  return <div className="solo-stack">
    <p className="solo-muted">Everything here is optional. Keep your lists in a notebook if you prefer; the Random Event and the d12 list rolls read them from here when you use them.</p>
    <div className="solo-lists">
      <TrackerList title="Threads" field="threads" empty="No open threads. Add the goals and loose ends you are following." placeholder="Find the missing caravan" play={play} />
      <TrackerList title="NPCs" field="characters" empty="No one yet. Add the people and creatures who matter." placeholder="The gate keeper" play={play} />
    </div>
    <ClocksPanel play={play} />
    <section className="solo-panel">
      <form onSubmit={event => { event.preventDefault(); void saveScene(); }}>
        <h2>Current scene {state.sceneNumber ? <span className="solo-chip">Scene {state.sceneNumber + 1}</span> : null}</h2>
        <label className="solo-field">Scene<input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="The eastern gate at dusk" /></label>
        <label className="solo-field">What you are trying to do<textarea rows={2} maxLength={2000} value={expected} onChange={event => setExpected(event.target.value)} placeholder="Get past the keeper without questions." /></label>
        <div className="solo-actions">
          <button className="daggery-roll-toggle" disabled={play.busy || !dirty}><Icon name="check" />{dirty ? 'Save scene' : 'Scene saved'}</button>
          <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void play.command({ command: 'end-scene' })}>End the scene</button>
        </div>
      </form>
    </section>
  </div>;
}

function TrackerList({ title, field, empty, placeholder, play }: { title: string; field: DualityList; empty: string; placeholder: string; play: Play }) {
  const items: SoloTrackerItem[] = play.state?.[field] ?? [];
  const [name, setName] = useState('');
  const [rolled, run] = useRolled(play);
  const open = items.filter(item => !item.done);
  const full = open.length >= SOLO_TRACKER_LIMIT;
  const save = (next: SoloTrackerItem[]) => play.track({ [field]: next });
  let line = 0;

  async function add() {
    if (await save([...items, { id: crypto.randomUUID(), name: name.trim(), note: '', done: false }])) setName('');
  }

  return <section className="solo-panel solo-tracker">
    <h2>{title} <span className="solo-chip">{open.length} of {SOLO_TRACKER_LIMIT} lines</span></h2>
    {items.length === 0
      ? <p className="solo-empty">{empty}</p>
      : <ul className="solo-tracker-list">{items.map(item => <li key={item.id} className={item.done ? 'is-done' : undefined}>
        <label><input type="checkbox" checked={item.done} disabled={play.busy || (item.done && full)} onChange={event => void save(items.map(other => other.id === item.id ? { ...other, done: event.target.checked } : other))} /><span><i className="solo-line-number">{item.done ? '·' : ++line}</i>{item.name}</span></label>
        <button type="button" aria-label={`Remove ${item.name}`} disabled={play.busy} onClick={() => void save(items.filter(other => other.id !== item.id))}><Icon name="trash" /></button>
      </li>)}</ul>}
    <form className="solo-tracker-add" onSubmit={event => { event.preventDefault(); void add(); }}>
      <label className="solo-field">Add to {title}<input value={name} maxLength={120} disabled={full} onChange={event => setName(event.target.value)} placeholder={placeholder} /></label>
      <button className="daggery-roll-toggle" disabled={play.busy || full || !name.trim()}><Icon name="plus" />Add</button>
    </form>
    {full && <p className="solo-muted">This list is full at {SOLO_TRACKER_LIMIT}, so a d12 can pick from it. Cross one off to add another.</p>}
    <div className="solo-actions">
      <button type="button" className="daggery-roll-toggle" disabled={play.busy || open.length === 0} onClick={() => void run('duality-list', { list: field })}><Icon name="dice" />Roll on this list (d12)</button>
    </div>
    <div aria-live="polite">{rolled && <ResultCard key={rolled.id} entry={rolled} play={play} />}</div>
  </section>;
}

function ClocksPanel({ play }: { play: Play }) {
  const clocks: SoloClock[] = play.state?.clocks ?? [];
  const [name, setName] = useState('');
  const [start, setStart] = useState(6);
  const save = (next: SoloClock[]) => play.track({ clocks: next });
  const full = clocks.length >= SOLO_CLOCK_LIMIT;
  const tick = (id: string, delta: number) => void save(clocks.map(item => item.id === id ? { ...item, current: Math.min(item.start, Math.max(0, item.current + delta)) } : item));

  async function add() {
    if (await save([...clocks, { id: crypto.randomUUID(), name: name.trim(), start, current: start }])) setName('');
  }

  return <section className="solo-panel">
    <h2>Countdowns</h2>
    <p className="solo-muted">Give every looming threat a countdown. Soft and Hard Moves tick it; at zero it happens, with no Fear needed.</p>
    {clocks.length > 0 && <ul className="solo-clock-list">{clocks.map(item => <li key={item.id} className={item.current === 0 ? 'is-done' : undefined}>
      <span>{item.name}{item.current === 0 && <strong> · it happens</strong>}</span>
      <div className="solo-fear-stepper" role="group" aria-label={`Countdown: ${item.name}`}>
        <button type="button" aria-label={`Tick ${item.name} down`} disabled={play.busy || item.current <= 0} onClick={() => tick(item.id, -1)}>−</button>
        <span className="solo-fear-value" aria-live="polite"><strong>{item.current}</strong><i> / {item.start}</i></span>
        <button type="button" aria-label={`Wind ${item.name} back`} disabled={play.busy || item.current >= item.start} onClick={() => tick(item.id, 1)}>+</button>
      </div>
      <button type="button" className="solo-icon-button" aria-label={`Remove countdown: ${item.name}`} disabled={play.busy} onClick={() => void save(clocks.filter(other => other.id !== item.id))}><Icon name="trash" /></button>
    </li>)}</ul>}
    <form className="solo-ask" onSubmit={event => { event.preventDefault(); void add(); }}>
      <label className="solo-field">Threat or goal<input value={name} maxLength={120} disabled={full} onChange={event => setName(event.target.value)} placeholder="The ritual completes" /></label>
      <label className="solo-field">Starts at<select value={start} onChange={event => setStart(Number(event.target.value))}>{[4, 6, 8, 10, 12].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <button className="daggery-roll-toggle" disabled={play.busy || full || !name.trim()}><Icon name="plus" />Add countdown</button>
    </form>
  </section>;
}

/** One rolled result. Keeping it in the app's notes is optional: many players write in their own notebook. */
function ResultCard({ entry, play }: { entry: SoloEntry; play: Play }) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const label = KIND_LABELS[entry.kind] ?? entry.kind;
  const asked = entry.question && entry.question !== entry.result.title && entry.question !== label ? entry.question : '';
  const suggestions = entry.result.suggestions ?? [];
  return <div className={`solo-result solo-tone-${entry.result.tone ?? 'neutral'}`}>
    <p className="solo-result-kind">{label}{asked ? ` · ${asked}` : ''}</p>
    <strong className="solo-result-title">{entry.result.title}</strong>
    {entry.result.detail && <p className="solo-result-detail">{entry.result.detail}</p>}
    {suggestions.length > 0 && <p className="solo-suggestions">Catalog: {suggestions.map(item => <span className="solo-chip" key={item.id}>{item.name}</span>)}</p>}
    {entry.accepted
      ? <p className="solo-interpretation"><Icon name="check" />{entry.interpretation}</p>
      : writing
        ? <form className="solo-result-keep" onSubmit={async event => { event.preventDefault(); if (await play.accept(entry.id, text.trim() || entry.result.title)) setWriting(false); }}>
          <label className="solo-field">What becomes true? (optional)
            <textarea rows={2} maxLength={6000} value={text} autoFocus onChange={event => setText(event.target.value)} placeholder={entry.result.title} />
          </label>
          <div className="solo-actions">
            <button className="daggery-roll-toggle" disabled={play.busy}><Icon name="check" />Save to notes</button>
            <button type="button" className="daggery-roll-toggle" onClick={() => setWriting(false)}>Cancel</button>
          </div>
        </form>
        : <button type="button" className="solo-link-button" onClick={() => setWriting(true)}><Icon name="plus" />Keep in notes</button>}
  </div>;
}

/** The rows a roll landed on, by table: `{ 'plot-hook': [[column, row]] }`. */
function landed(entries: (SoloEntry | undefined)[]): Map<string, [number, number][]> {
  const found = new Map<string, [number, number][]>();
  for (const entry of entries) for (const cell of entry?.result.cells ?? []) found.set(cell.table, [...(found.get(cell.table) ?? []), [cell.column, cell.roll]]);
  return found;
}

/** A printed d12 table, open by default, with the rows the last roll landed on marked. */
function LookupTable({ id, hits, open = true }: { id: string; hits: Map<string, [number, number][]>; open?: boolean }) {
  const table = dualityTable(id);
  const marks = hits.get(id) ?? [];
  // With several columns, only the cells a roll used are marked, not the whole row.
  const isRow = (row: number) => table.columns.length === 1 && marks.some(([, roll]) => roll === row);
  const isCell = (column: number, row: number) => marks.some(([col, roll]) => col === column && roll === row);
  return <details className="solo-table" open={open}>
    <summary><span className="solo-table-title">{table.title}</span><span className="solo-chip">d12</span></summary>
    <div className="solo-reference-table solo-table-scroll">
      <table className="solo-lookup-table">
        <thead><tr><th scope="col">d12</th>{table.columns.map(item => <th scope="col" key={item.label}>{item.label}</th>)}</tr></thead>
        <tbody>{Array.from({ length: 12 }, (_, row) => <tr key={row} className={isRow(row + 1) ? 'is-rolled' : undefined}>
          <td className="solo-range">{row + 1}</td>
          {table.columns.map((item, column) => <td key={item.label} className={isCell(column, row + 1) ? 'is-answer' : undefined}>{item.entries[row]}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </details>;
}

/** One step of the play loop: what to do, the button, the result, and the tables it uses. */
function Step({ n, id, title, hint, children, tables }: { n: string; id: string; title: string; hint: React.ReactNode; children: React.ReactNode; tables?: React.ReactNode }) {
  return <section className="solo-panel solo-step" id={id} aria-labelledby={`${id}-title`}>
    <div className="solo-step-main">
      <h2 id={`${id}-title`}><span className="solo-step-number">{n}</span>{title}</h2>
      <p className="solo-muted">{hint}</p>
      {children}
    </div>
    {tables && <div className="solo-step-tables">{tables}</div>}
  </section>;
}

const LOOP: [string, string][] = [
  ['step-hook', 'Plot hook'], ['step-event', 'Random Event'], ['step-scene', 'Set the scene'], ['step-oracle', 'Oracle'],
  ['step-moves', 'GM Moves'], ['step-combat', 'Combat'], ['step-next', 'Next scene'],
];

/**
 * The play loop, in the order you use it (after the One Page Solo Engine): roll a plot hook and a
 * Random Event, set the scene, ask the oracle, play, make GM Moves, then set the next scene.
 */
function PlayTab({ play }: { play: Play }) {
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return <div className="solo-stack">
    <nav className="solo-loop" aria-label="Play loop">
      <ol>{LOOP.map(([id, label], index) => <li key={id}><button type="button" onClick={() => jump(id)}><b>{index + 1}</b>{label}</button></li>)}</ol>
      <p className="solo-muted">Create your character first. Then roll a plot hook and a Random Event, set the scene, and play: ask the oracle, roll as normal, and let GM Moves push back. When the scene ends, set the next one.</p>
    </nav>
    <HookStep play={play} />
    <EventStep play={play} />
    <SceneStep play={play} />
    <OracleStep play={play} />
    <MovesStep play={play} />
    <CombatStep play={play} />
    <Step n="7" id="step-next" title="Set the next scene" hint="Decide what your character does next, update your Threads and NPCs if you track them, and set the scene again. Rest and downtime add Fear as the rules say.">
      <div className="solo-actions">
        <button type="button" className="daggery-primary" onClick={() => jump('step-scene')}><Icon name="dice" />Set the next scene</button>
        <button type="button" className="daggery-roll-toggle" disabled={play.busy || !play.state} onClick={() => void play.command({ command: 'end-scene' })}>Log the end of this scene</button>
      </div>
    </Step>
  </div>;
}

function HookStep({ play }: { play: Play }) {
  const [rolled, run] = useRolled(play);
  const hits = landed([rolled]);
  return <Step n="1" id="step-hook" title="Plot hook" hint="Why is your character here? Roll once per column: Objective, Opposition, Reward, and a Twist you keep hidden until a Random Event or Hard Move gives it an opening."
    tables={<><LookupTable id="plot-hook" hits={hits} /><LookupTable id="plot-stakes" hits={hits} /></>}>
    <div className="solo-actions"><button type="button" className="daggery-primary" disabled={play.busy} onClick={() => void run('duality-plot')}><Icon name="dice" />Roll a plot hook</button></div>
    <div aria-live="polite">{rolled && <ResultCard key={rolled.id} entry={rolled} play={play} />}</div>
  </Step>;
}

function EventStep({ play }: { play: Play }) {
  const [focus, setFocus] = useState('');
  const [rolled, run] = useRolled(play);
  const hits = landed([rolled]);
  return <Step n="2" id="step-event" title="Random Event" hint="Something is already in motion. Roll the Event Focus, then Action + Subject for what happens. Oracle doubles and Interrupted scenes roll one too. Focus 4–6 picks an NPC from your list, 7–9 a Thread."
    tables={<><LookupTable id="event-focus" hits={hits} /><LookupTable id="action" hits={hits} open={false} /><LookupTable id="subject" hits={hits} open={false} /></>}>
    <form className="solo-ask" onSubmit={submit => { submit.preventDefault(); void run('duality-event', { focus: focus === '' ? undefined : Number(focus) }); }}>
      <label className="solo-field">Event focus<select value={focus} onChange={change => setFocus(change.target.value)}>
        <option value="">Roll d12</option>
        {EVENT_FOCUS.map((label, index) => <option key={index} value={index + 1}>{index + 1}. {label}</option>)}
      </select></label>
      <button className="daggery-primary" disabled={play.busy}><Icon name="dice" />Roll a Random Event</button>
    </form>
    <div aria-live="polite">{rolled && <ResultCard key={rolled.id} entry={rolled} play={play} />}</div>
  </Step>;
}

function SceneStep({ play }: { play: Play }) {
  const [where, setWhere] = useState('');
  const [rolled, run] = useRolled(play);
  const hits = landed([rolled]);
  return <Step n="3" id="step-scene" title="Set the scene" hint={<>Say where your character is and what they are trying to do (here or in your notebook). Every scene gets a <b>Scene Complication</b>. Then a Fear Check ({play.fear} Fear): a pass spends 1 Fear and the scene is <b>Altered</b> (odd roll) or <b>Interrupted</b> by a Random Event (even roll).</>}
    tables={<><LookupTable id="scene-complication" hits={hits} /><LookupTable id="altered-scene" hits={hits} /></>}>
    <form className="solo-ask" onSubmit={submit => { submit.preventDefault(); void run('duality-scene', { question: where.trim() }).then(entry => { if (entry) setWhere(''); }); }}>
      <label className="solo-field">Scene (optional)<input value={where} maxLength={200} onChange={change => setWhere(change.target.value)} placeholder="Sneaking into the keep at night" /></label>
      <button className="daggery-primary" disabled={play.busy}><Icon name="dice" />Set the scene</button>
    </form>
    <div aria-live="polite">{rolled && <ResultCard key={rolled.id} entry={rolled} play={play} />}</div>
  </Step>;
}

function OracleStep({ play }: { play: Play }) {
  const campaign = getActiveCampaign();
  const [question, setQuestion] = useState('');
  const [likelihood, setLikelihood] = useState('even');
  const [mode, setMode] = useState<DiceMode>(() => diceModeFor(campaign.id));
  const [hopeDie, setHopeDie] = useState('');
  const [fearDie, setFearDie] = useState('');
  const [choice, setChoice] = useState('action-subject');
  const [answer, ask] = useRolled(play);
  const [much, rollMuch] = useRolled(play);
  const [meaning, rollMeaning] = useRolled(play);
  const physical = mode === 'physical';
  const diceReady = !physical || (validDie(hopeDie, 12) && validDie(fearDie, 12));
  const chooseMode = (next: DiceMode) => { setMode(next); setDiceMode(campaign.id, next); };
  const askedBand = answer?.result.target;

  async function submit() {
    const entry = await ask('duality-oracle', { question: question.trim(), likelihood, ...(physical ? { dice: { hope: Number(hopeDie), fear: Number(fearDie) } } : {}) });
    if (entry) { setQuestion(''); setHopeDie(''); setFearDie(''); }
  }

  return <Step n="4" id="step-oracle" title="Ask the Oracle" hint="Whenever you would ask a GM, ask a yes or no question, pick how likely a yes is, and roll Hope + Fear. Dice 4 or more apart twist the answer; doubles also bring a Random Event. Oracle rolls never make Hope or Fear."
    tables={<>
      <div className="solo-reference-table solo-oracle-chart-wrap">
        <table className="solo-oracle-chart">
          <thead><tr><th scope="col">Likelihood</th><th scope="col">Yes on</th><th scope="col">Chance</th></tr></thead>
          <tbody>{DUALITY_LIKELIHOODS.map(row => <tr key={row.id} className={answer && askedBand === row.target ? 'is-rolled' : row.id === 'even' ? 'is-mid' : undefined}>
            <th scope="row">{row.label}</th><td className="solo-range">{row.target}+</td><td className="solo-range">{row.chance}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="solo-shift-note">Hope higher by 4+: <i>Yes, and…</i> / <i>No, but…</i>. Fear higher by 4+: <i>Yes, but…</i> / <i>No, and…</i>.</p>
      <LookupTable id="how-much" hits={landed([much])} />
      <LookupTable id="action" hits={landed([meaning])} open={false} />
      <LookupTable id="subject" hits={landed([meaning])} open={false} />
      <LookupTable id="descriptor" hits={landed([meaning])} open={false} />
    </>}>
    <form className="solo-oracle-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label className="solo-field">Question (optional)<input value={question} maxLength={2000} onChange={change => setQuestion(change.target.value)} placeholder="Is the gate guarded?" /></label>
      <div className="solo-likelihoods" role="radiogroup" aria-label="Likelihood">
        {DUALITY_LIKELIHOODS.map(row => <button key={row.id} type="button" role="radio" aria-checked={likelihood === row.id} onClick={() => setLikelihood(row.id)}>{row.label}<small>{row.chance}</small></button>)}
      </div>
      <div className="solo-row">
        <div className="solo-dice-mode" role="group" aria-label="Dice">
          <button type="button" aria-pressed={!physical} onClick={() => chooseMode('digital')}>Digital dice</button>
          <button type="button" aria-pressed={physical} onClick={() => chooseMode('physical')}>My physical dice</button>
        </div>
        {physical && <div className="solo-dice-fields">
          <label className="solo-field">Hope d12<input inputMode="numeric" value={hopeDie} maxLength={2} onChange={change => setHopeDie(change.target.value)} placeholder="1-12" /></label>
          <label className="solo-field">Fear d12<input inputMode="numeric" value={fearDie} maxLength={2} onChange={change => setFearDie(change.target.value)} placeholder="1-12" /></label>
        </div>}
        <button className="daggery-primary" disabled={play.busy || !diceReady}><Icon name="dice" />Ask the Oracle</button>
      </div>
    </form>
    <div aria-live="polite">{answer && <ResultCard key={answer.id} entry={answer} play={play} />}</div>

    <h3 className="solo-subhead">How much? How well?</h3>
    <p className="solo-muted">How big, strong, many or good something is.</p>
    <div className="solo-actions"><button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void rollMuch('duality-table', { tableId: 'how-much', column: 0 })}><Icon name="dice" />Roll How Much</button></div>
    <div aria-live="polite">{much && <ResultCard key={much.id} entry={much} play={play} />}</div>

    <h3 className="solo-subhead">Open questions: Meaning</h3>
    <p className="solo-muted">For what a yes or no cannot answer. Hope die picks the row, Fear die the column (odd A, even B).</p>
    <form className="solo-ask" onSubmit={event => { event.preventDefault(); void rollMeaning('duality-meaning', { choice, count: 1 }); }}>
      <label className="solo-field">Words<select value={choice} onChange={change => setChoice(change.target.value)}>
        {DUALITY_MEANING_CHOICES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        <option value="generic">Generic generator (what it is, what it does, how much)</option>
      </select></label>
      <button className="daggery-roll-toggle" disabled={play.busy}><Icon name="dice" />Roll meaning</button>
    </form>
    <div aria-live="polite">{meaning && <ResultCard key={meaning.id} entry={meaning} play={play} />}</div>
  </Step>;
}

function MovesStep({ play }: { play: Play }) {
  const [moved, move] = useRolled(play);
  const hits = landed([moved]);
  return <Step n="5" id="step-moves" title="GM Moves" hint="After an action roll, say how it went. Success with Hope and criticals need no move. Failure with Fear and a stalled story make a Fear Check: a pass is a Hard Move and spends 1 Fear."
    tables={<><LookupTable id="soft-move" hits={hits} /><LookupTable id="hard-move" hits={hits} /></>}>
    <div className="solo-move-grid">
      {DUALITY_MOVE_TRIGGERS.map(trigger => <button key={trigger.id} type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void move('duality-move', { trigger: trigger.id, question: trigger.label })}>
        <Icon name="dice" />{trigger.label}{trigger.checks ? <small>Fear Check</small> : <small>Soft Move</small>}
      </button>)}
    </div>
    <div aria-live="polite">{moved && <ResultCard key={moved.id} entry={moved} play={play} />}</div>
  </Step>;
}

function CombatStep({ play }: { play: Play }) {
  const { items } = useDocs<Sheet>('sheets');
  const level = Object.values(items)[0]?.level;
  const [tier, setTier] = useState('');
  const [found, encounter] = useRolled(play);
  const [acted, spotlight] = useRolled(play);
  const chosenTier = tier || (level ? String(tierFor(level)) : '');
  return <Step n="6" id="step-combat" title="Adversaries and combat" hint="When trouble is a fight, roll who you face: what the creature is, what it is doing, and its Daggerheart type. Then, each time the spotlight passes to the GM, roll the spotlight; after each GM action, roll the chain."
    tables={<>
      <LookupTable id="adversary-creature" hits={landed([found])} />
      <LookupTable id="adversary-type" hits={landed([found])} />
      <LookupTable id="tactics" hits={landed([acted])} open={false} />
      <LookupTable id="fear-spend" hits={landed([acted])} open={false} />
    </>}>
    <form className="solo-ask" onSubmit={event => { event.preventDefault(); void encounter('duality-encounter', { tier: chosenTier ? Number(chosenTier) : undefined }); }}>
      <label className="solo-field">Tier for catalog picks<select value={chosenTier} onChange={change => setTier(change.target.value)}>
        <option value="">Any tier</option>
        {[1, 2, 3, 4].map(value => <option key={value} value={value}>Tier {value}</option>)}
      </select></label>
      <button className="daggery-primary" disabled={play.busy}><Icon name="dice" />Roll an encounter</button>
    </form>
    <div aria-live="polite">{found && <ResultCard key={found.id} entry={found} play={play} />}</div>
    <h3 className="solo-subhead">GM turn</h3>
    <p className="solo-muted">Pick the adversary that makes most sense. A failed Fear Check means it acts for free (Tactics); a pass spends Fear (Fear Spend). The chain ends the GM turn on the first failed check.</p>
    <div className="solo-actions">
      <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void spotlight('duality-adversary')}><Icon name="dice" />GM spotlight</button>
      <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void spotlight('duality-adversary', { chain: true })}><Icon name="dice" />Chain: next adversary</button>
    </div>
    <div aria-live="polite">{acted && <ResultCard key={acted.id} entry={acted} play={play} />}</div>
  </Step>;
}

const GENERATORS: { id: string; title: string; hint: string; actions: { label: string; kind: string; values?: Record<string, unknown> }[] }[] = [
  { id: 'npc', title: 'NPC', hint: 'Role, Motive, Attitude, Quirk and a Topic of conversation. Attitude is the first reaction; after that the NPC follows their Motive.',
    actions: [{ label: 'Generate an NPC', kind: 'duality-npc' }] },
  { id: 'encounter', title: 'Encounter', hint: 'Creature, what it is doing, its Daggerheart adversary type, and up to three fitting stat blocks from the catalog.',
    actions: [{ label: 'Roll an encounter', kind: 'duality-encounter' }] },
  { id: 'plot', title: 'Plot hook', hint: 'Objective, Opposition, Reward and a Twist to keep hidden until a Random Event or Hard Move gives it an opening.',
    actions: [{ label: 'Generate a plot hook', kind: 'duality-plot' }] },
  { id: 'site', title: 'Site crawler', hint: 'For dungeons, ruins and lairs. Roll each new area. The first time the Area is the Heart of the site, you have found it.',
    actions: [{ label: 'Next area', kind: 'duality-site' }] },
  { id: 'journey', title: 'Journey', hint: 'For each leg of travel, a Fear Check: a pass spends 1 Fear and rolls a Danger, a fail rolls a Discovery.',
    actions: [{ label: 'Travel a leg', kind: 'duality-journey' }] },
  { id: 'generic', title: 'Generic generator', hint: 'For anything else: a room, a relic, a rumor, a town. What it is, what it does, and how big or strong it is.',
    actions: [{ label: 'Generate', kind: 'duality-meaning', values: { choice: 'generic' } }] },
];

function GeneratorsTab({ play }: { play: Play }) {
  return <div className="solo-stack">{GENERATORS.map(item => <Generator key={item.id} item={item} play={play} />)}</div>;
}
function Generator({ item, play }: { item: (typeof GENERATORS)[number]; play: Play }) {
  const [rolled, run] = useRolled(play);
  return <section className="solo-panel">
    <h2>{item.title}</h2>
    <p className="solo-muted">{item.hint}</p>
    <div className="solo-actions">{item.actions.map((action, index) =>
      <button key={action.label} type="button" className={index === 0 ? 'daggery-primary' : 'daggery-roll-toggle'} disabled={play.busy} onClick={() => void run(action.kind, action.values)}><Icon name="dice" />{action.label}</button>)}
    </div>
    <div aria-live="polite">{rolled && <ResultCard key={rolled.id} entry={rolled} play={play} />}</div>
  </section>;
}

function TablesTab({ play }: { play: Play }) {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const shown = DUALITY_TABLE_GROUPS
    .map(group => ({ ...group, tables: DUALITY_TABLES.filter(table => table.group === group.id && table.title.toLowerCase().includes(needle)) }))
    .filter(group => group.tables.length > 0);

  return <div className="solo-stack">
    <label className="solo-field solo-table-filter">Find a table<input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Table name" /></label>
    {shown.length === 0 && <p className="solo-empty">No tables match “{filter.trim()}”.</p>}
    {shown.map(group => <section className="solo-tables-group" key={group.id} aria-labelledby={`solo-group-${group.id}`}>
      <h2 id={`solo-group-${group.id}`}>{group.label}</h2>
      <div className="solo-table-stack">
        {group.tables.map(table => <details className="solo-table" key={table.id} open={needle ? true : undefined}>
          <summary><span className="solo-table-title">{table.title}</span><span className="solo-chip">d12</span></summary>
          <TableRoller table={table} play={play} />
        </details>)}
      </div>
    </section>)}
  </div>;
}

/** Rolls one column of a table on the server and marks the row it landed on. */
function TableRoller({ table, play }: { table: DualityTable; play: Play }) {
  const [column, setColumn] = useState(0);
  const [rolled, run] = useRolled(play);
  const [rolledColumn, setRolledColumn] = useState(0);
  const total = rolled?.result.total;

  return <>
    <div className="solo-table-roll">
      {table.columns.length > 1 && <label className="solo-field">Column<select aria-label={`Column of ${table.title}`} value={column} onChange={event => setColumn(Number(event.target.value))}>
        {table.columns.map((item, index) => <option key={item.label} value={index}>{item.label}</option>)}
      </select></label>}
      <button type="button" className="daggery-primary" disabled={play.busy} onClick={() => { setRolledColumn(column); void run('duality-table', { tableId: table.id, column }); }}><Icon name="dice" />Roll d12</button>
    </div>
    <div aria-live="polite">{rolled && <ResultCard key={rolled.id} entry={rolled} play={play} />}</div>
    <div className="solo-reference-table solo-table-scroll">
      <table className="solo-lookup-table">
        <thead><tr><th scope="col">d12</th>{table.columns.map(item => <th scope="col" key={item.label}>{item.label}</th>)}</tr></thead>
        <tbody>{Array.from({ length: 12 }, (_, row) => <tr key={row} className={total === row + 1 ? 'is-rolled' : undefined}>
          <td className="solo-range">{row + 1}</td>
          {table.columns.map((item, index) => <td key={item.label} className={total === row + 1 && index === rolledColumn ? 'is-answer' : undefined}>{item.entries[row]}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </>;
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
