import { useEffect, useRef, useState } from 'react';
import {
  DUALITY_ENGINE_VERSION, DUALITY_MAX_FEAR, DUALITY_MEANING_CHOICES, DUALITY_TABLE_GROUPS,
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
import './solo.css';
import './folio.css';
import { IronPlay } from './IronPlay';
import { Rulebook } from './Rulebook';
import { KIND_LABELS, landed, LookupTable, ResultCard, useRolled, type Play } from './parts';

type Tab = 'play' | 'tables' | 'generators' | 'tracker' | 'dice' | 'notes' | 'guide';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not complete the action.';
const root = () => `/api/campaigns/${encodeURIComponent(getActiveCampaign().id)}/solo`;

export default function SoloPlay({ author: _author }: { author: string }) {
  if (!hasFeature(getActiveCampaign().configuration, 'daggerheart.solo') || getActiveCampaign().role !== 'gm') return <p>Solo play is not enabled for this campaign.</p>;
  return <Workspace />;
}

function Workspace() {
  const campaign = getActiveCampaign();
  const [tab, setTab] = useState<Tab>('play');
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [state, setStateValue] = useState<SoloState | null>(null);
  // Saves that follow each other (save a track, then end the scene) must use the newest revision.
  const latest = useRef<SoloState | null>(null);
  const setState = (next: SoloState) => { latest.current = next; setStateValue(next); };
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
    const current = latest.current;
    if (!current) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      const { state: next } = await api<{ state: SoloState }>(`${root()}/tracker`, 'PUT', { revision: current.revision, ...patch });
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
    const current = latest.current;
    if (!current) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      const done = await api<{ state: SoloState; detail: string }>(`${root()}/command`, 'POST', { revision: current.revision, ...values });
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
      <div className="solo-heading-copy">
        <span className="solo-emblem" aria-hidden="true"><Icon name="dice" /><Icon name="spark" /></span>
        <p className="solo-kicker">{getRuleset(campaign.configuration)?.name} · {`Duality GME ${DUALITY_ENGINE_VERSION}`}</p>
        <h1>Solo play</h1>
        <p className="solo-heading-description">A world to discover. A story only you can tell.</p>
      </div>
      <div className="solo-heading-actions">
        <button type="button" className="solo-guide-link" aria-pressed={tab === 'guide'} onClick={() => setTab(tab === 'guide' ? 'play' : 'guide')}><Icon name="book" />Play guide</button>
        <button type="button" className="daggery-roll-toggle solo-sheet-link" onClick={openSheet}><Icon name="sheet" />Character sheet</button>
      </div>
    </header>
    <button type="button" className="solo-resource-toggle" aria-expanded={resourcesOpen} aria-controls="solo-resources" onClick={() => setResourcesOpen(value => !value)}><Icon name="heart" /><span>Character resources</span><span className="solo-resource-fear">Fear {fear} / {DUALITY_MAX_FEAR}</span><Icon name={resourcesOpen ? 'minus' : 'plus'} /></button>
    <div id="solo-resources" className={`solo-resources${resourcesOpen ? ' is-expanded' : ''}`}><HeroStrip /><FearPanel play={play} /></div>
    <nav className="solo-tabs" aria-label="Solo sections">
      {tabs.map(([id, label]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon name={id === 'play' ? 'compass' : id === 'tables' ? 'book' : id === 'generators' ? 'spark' : id === 'tracker' ? 'users' : id === 'dice' ? 'dice' : 'note'} /><span>{label}</span></button>)}
    </nav>
    {error && <p role="alert" className="solo-alert">{error}</p>}
    {notice && <p role="status" className="solo-notice"><Icon name="check" />{notice}</p>}
    <div className="solo-play-surface" hidden={tab !== 'play'}><IronPlay play={play} /></div>
    {tab === 'guide' && <Rulebook onReturn={() => setTab('play')} />}
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
    <p className="solo-muted">Give every looming threat a countdown. Advance it when a move or the fiction calls for it; at zero the threat happens.</p>
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

type GeneratorItem = { id: string; title: string; hint: string; tables: string[]; actions: { label: string; kind: string; values?: Record<string, unknown> }[] };
const generate = (tableId: string) => ({ kind: 'duality-generate', values: { tableId } });
const GENERATORS: GeneratorItem[] = [
  { id: 'npc', title: 'NPC', hint: 'Name, Role, Motive, Attitude, Quirk and a Topic of conversation. Attitude is the first reaction; after that the NPC follows their Motive.',
    tables: ['names', 'npc-identity', 'npc-manner'], actions: [{ label: 'Generate an NPC', kind: 'duality-npc' }, { label: 'Just a name', ...generate('names') }] },
  { id: 'settlement', title: 'Settlement', hint: 'A name, how big it is, what it is known for, and its trouble: a ready hook for your next scene.',
    tables: ['place-name', 'settlement'], actions: [{ label: 'Generate a settlement', ...generate('settlement') }, { label: 'Just a place name', ...generate('place-name') }] },
  { id: 'wilds', title: 'Wilds', hint: 'The land, the weather and a landmark for each new region or day of travel.',
    tables: ['wilds'], actions: [{ label: 'Roll the wilds', ...generate('wilds') }] },
  { id: 'journey', title: 'Journey', hint: 'For each leg of travel, a Fear Check: a pass spends 1 Fear and rolls a Danger, a fail rolls a Discovery.',
    tables: ['journey'], actions: [{ label: 'Travel a leg', kind: 'duality-journey' }] },
  { id: 'site', title: 'Site crawler', hint: 'For dungeons, ruins and lairs. Roll each new area. The first time the Area is the Heart of the site, you have found it.',
    tables: ['site', 'hazard'], actions: [{ label: 'Next area', kind: 'duality-site' }, { label: 'Roll a hazard', ...generate('hazard') }] },
  { id: 'rest', title: 'Rest and camp', hint: 'What happens while you rest. Rests still add Fear as the rules say.',
    tables: ['rest'], actions: [{ label: 'Roll the rest', ...generate('rest') }] },
  { id: 'rumor', title: 'Rumors and leads', hint: 'Where the next scene could come from, or what people are whispering.',
    tables: ['rumor'], actions: [{ label: 'Roll a lead', ...generate('rumor') }] },
  { id: 'encounter', title: 'Encounter', hint: 'Creature, what it is doing, its Daggerheart adversary type, and up to three fitting stat blocks from the catalog.',
    tables: ['adversary-creature', 'adversary-type'], actions: [{ label: 'Roll an encounter', kind: 'duality-encounter' }] },
  { id: 'treasure', title: 'Loot and treasure', hint: 'What the fallen carry, what the vault holds, and the detail that makes it a story.',
    tables: ['treasure'], actions: [{ label: 'Roll loot', ...generate('treasure') }] },
  { id: 'faction', title: 'Faction', hint: 'Who they are, what they want, and how they get it. Add them to your NPCs or Threads if they matter.',
    tables: ['faction'], actions: [{ label: 'Generate a faction', ...generate('faction') }] },
  { id: 'plot', title: 'Plot hook', hint: 'Objective, Opposition, Reward and a Twist to keep hidden until a Random Event or Hard Move gives it an opening.',
    tables: ['plot-hook', 'plot-stakes'], actions: [{ label: 'Generate a plot hook', kind: 'duality-plot' }] },
  { id: 'generic', title: 'Generic generator', hint: 'For anything else: a room, a relic, a rumor, a town. What it is, what it does, and how big or strong it is.',
    tables: ['descriptor', 'subject', 'action', 'how-much'], actions: [{ label: 'Generate', kind: 'duality-meaning', values: { choice: 'generic' } }] },
];

function GeneratorsTab({ play }: { play: Play }) {
  return <div className="solo-stack">
    <nav className="solo-loop" aria-label="Generators">
      <ol className="solo-jump">{GENERATORS.map(item => <li key={item.id}><button type="button" onClick={() => document.getElementById(`gen-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{item.title}</button></li>)}</ol>
    </nav>
    {GENERATORS.map(item => <Generator key={item.id} item={item} play={play} />)}
  </div>;
}
function Generator({ item, play }: { item: GeneratorItem; play: Play }) {
  const [rolled, run] = useRolled(play);
  const hits = landed([rolled]);
  return <section className="solo-panel solo-step" id={`gen-${item.id}`} aria-labelledby={`gen-${item.id}-title`}>
    <div className="solo-step-main">
      <h2 id={`gen-${item.id}-title`}>{item.title}</h2>
      <p className="solo-muted">{item.hint}</p>
      <div className="solo-actions">{item.actions.map((action, index) =>
        <button key={action.label} type="button" className={index === 0 ? 'daggery-primary' : 'daggery-roll-toggle'} disabled={play.busy} onClick={() => void run(action.kind, action.values)}><Icon name="dice" />{action.label}</button>)}
      </div>
      <div aria-live="polite">{rolled && <ResultCard key={rolled.id} entry={rolled} play={play} />}</div>
    </div>
    <div className="solo-step-tables">{item.tables.map((id, index) => <LookupTable key={id} id={id} hits={hits} open={index < 2} />)}</div>
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
