import { useEffect, useRef, useState } from 'react';
import {
  DUALITY_LIKELIHOODS, DUALITY_MAX_FEAR, DUALITY_MEANING_CHOICES, DUALITY_MOVE_TRIGGERS, DUALITY_TABLE_GROUPS, DUALITY_TABLES,
  dualityTable, getRuleset, hasFeature, rollDice, SOLO_CLOCK_LIMIT, SOLO_TRACKER_LIMIT,
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

type Tab = 'scene' | 'oracle' | 'generators' | 'tables' | 'dice' | 'notes';
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
const root = () => `/api/campaigns/${encodeURIComponent(getActiveCampaign().id)}/solo`;
const KIND_LABELS: Record<string, string> = {
  'duality-scene': 'Scene setup', 'duality-oracle': 'Oracle', 'duality-meaning': 'Meaning', 'duality-table': 'Table', 'duality-event': 'Random Event',
  'duality-move': 'GM Move', 'duality-list': 'List roll', 'duality-fear-check': 'Fear Check', 'duality-adversary': 'Adversary', 'duality-npc': 'NPC',
  'duality-plot': 'Plot hook', 'duality-site': 'Site', 'duality-journey': 'Journey', journal: 'Note', procedure: 'Procedure',
};
const EVENT_FOCUS = dualityTable('event-focus').columns[0]!.entries;

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
  const tabs: [Tab, string][] = [['scene', 'Scene'], ['oracle', 'Oracle'], ['generators', 'Generators'], ['tables', 'Tables'], ['dice', 'Dice'], ['notes', 'Notes']];

  return <div className="solo-workspace">
    <header className="solo-heading">
      <div>
        <p className="solo-kicker">{getRuleset(campaign.configuration)?.name} · Duality Solo Engine</p>
        <h1><Icon name="spark" />Solo play</h1>
        <p>The Fear pool plays the GM. Ask the oracle, let Fear Checks decide when the world acts, and keep what becomes true.</p>
      </div>
      <button type="button" className="daggery-primary solo-sheet-link" onClick={openSheet}><Icon name="sheet" />Open character sheet</button>
    </header>
    <HeroStrip />
    <FearPanel play={play} />
    <nav className="solo-tabs" aria-label="Solo sections">
      {tabs.map(([id, label]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    {error && <p role="alert" className="solo-alert">{error}</p>}
    {notice && <p role="status" className="solo-notice"><Icon name="check" />{notice}</p>}
    {tab === 'scene' && (state ? <SceneTab play={play} /> : !error && <p className="solo-empty">Loading your scene…</p>)}
    {tab === 'oracle' && <OracleTab play={play} />}
    {tab === 'generators' && <GeneratorsTab play={play} />}
    {tab === 'tables' && <TablesTab play={play} />}
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

function SceneTab({ play }: { play: Play }) {
  const state = play.state!;
  const scene = state.scene;
  const [title, setTitle] = useState(scene.title);
  const [expected, setExpected] = useState(scene.expected);
  const [tested, run] = useRolled(play);
  const [moved, move] = useRolled(play);
  // Ending a scene clears it on the server: follow that here.
  useEffect(() => { setTitle(scene.title); setExpected(scene.expected); }, [scene.title, scene.expected]);
  const dirty = title.trim() !== scene.title || expected.trim() !== scene.expected;
  const saveScene = () => play.track({ scene: { title: title.trim(), expected: expected.trim() } });

  async function testScene() {
    if (dirty && !(await saveScene())) return;
    await run('duality-scene', { question: title.trim() });
  }

  return <div className="solo-stack">
    <section className="solo-panel">
      <form onSubmit={event => { event.preventDefault(); void saveScene(); }}>
        <h2>Current scene {state.sceneNumber ? <span className="solo-chip">Scene {state.sceneNumber + 1}</span> : null}</h2>
        <p className="solo-muted">Say where you are and what you expect to happen, then test it. A passed Fear Check spends 1 Fear and alters the scene (odd roll) or interrupts it (even roll).</p>
        <label className="solo-field">Scene<input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="The eastern gate at dusk" /></label>
        <label className="solo-field">What you expect<textarea rows={2} maxLength={2000} value={expected} onChange={event => setExpected(event.target.value)} placeholder="The keeper lets me through without questions." /></label>
        <div className="solo-actions">
          <button className="daggery-roll-toggle" disabled={play.busy || !dirty}><Icon name="check" />{dirty ? 'Save scene' : 'Scene saved'}</button>
          <button type="button" className="daggery-primary" disabled={play.busy} onClick={() => void testScene()}><Icon name="dice" />Test the scene</button>
          <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void play.command({ command: 'end-scene' })}>End the scene</button>
        </div>
      </form>
      <div aria-live="polite">{tested && <ResultCard key={tested.id} entry={tested} play={play} />}</div>
    </section>

    <section className="solo-panel">
      <h2>GM Move</h2>
      <p className="solo-muted">After an action roll, say how it went. Success with Hope and criticals need no move. Hard Moves cost 1 Fear, which the engine spends.</p>
      <div className="solo-actions">
        {DUALITY_MOVE_TRIGGERS.map(trigger => <button key={trigger.id} type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void move('duality-move', { trigger: trigger.id, question: trigger.label })}>
          <Icon name="dice" />{trigger.label}{trigger.checks ? ' (Fear Check)' : ''}
        </button>)}
      </div>
      <div aria-live="polite">{moved && <ResultCard key={moved.id} entry={moved} play={play} />}</div>
    </section>

    <div className="solo-lists">
      <TrackerList title="Threads" field="threads" empty="No open threads. Add the goals and loose ends you are following." placeholder="Find the missing caravan" play={play} />
      <TrackerList title="NPCs" field="characters" empty="No one yet. Add the people and creatures who matter." placeholder="The gate keeper" play={play} />
    </div>
    <ClocksPanel play={play} />
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

function OracleTab({ play }: { play: Play }) {
  const [question, setQuestion] = useState('');
  const [likelihood, setLikelihood] = useState('even');
  const [asked, setAsked] = useState<{ id: string; likelihood: string } | null>(null);
  const [focus, setFocus] = useState('');
  const [choice, setChoice] = useState('action-subject');
  const [count, setCount] = useState(1);
  const [event, runEvent] = useRolled(play);
  const [meaning, runMeaning] = useRolled(play);
  const answer = asked ? play.entries.find(entry => entry.id === asked.id) : undefined;

  async function ask() {
    const entry = await play.roll('duality-oracle', { question: question.trim(), likelihood });
    if (entry) { setAsked({ id: entry.id, likelihood }); setQuestion(''); }
  }

  return <div className="solo-stack">
    <section className="solo-panel">
      <h2>Ask the Oracle</h2>
      <p className="solo-muted">Ask a yes or no question, choose how likely a yes is, and roll Hope + Fear. Oracle rolls never generate Hope or Fear.</p>
      <form className="solo-ask" onSubmit={submit => { submit.preventDefault(); void ask(); }}>
        <label className="solo-field">Question<input value={question} maxLength={2000} onChange={change => setQuestion(change.target.value)} placeholder="Is the gate guarded?" /></label>
        <label className="solo-field">Likelihood<select value={likelihood} onChange={change => setLikelihood(change.target.value)}>{DUALITY_LIKELIHOODS.map(row => <option key={row.id} value={row.id}>{row.label} ({row.target}+)</option>)}</select></label>
        <button className="daggery-primary" disabled={play.busy || !question.trim()}><Icon name="dice" />Ask</button>
      </form>
      <div aria-live="polite">{answer && <ResultCard key={answer.id} entry={answer} play={play} />}</div>
      <div className="solo-reference-table solo-oracle-chart-wrap">
        <table className="solo-oracle-chart">
          <thead><tr><th scope="col">Likelihood</th><th scope="col">Yes on</th><th scope="col">Chance</th></tr></thead>
          <tbody>{DUALITY_LIKELIHOODS.map(row => <tr key={row.id} className={[row.id === 'even' ? 'is-mid' : '', answer && asked?.likelihood === row.id ? 'is-rolled' : ''].join(' ').trim() || undefined}>
            <th scope="row">{row.label}</th><td className="solo-range">{row.target}+</td><td className="solo-range">{row.chance}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="solo-shift-note">Dice 4 or more apart add a twist: Hope higher bends it your way (Yes, and… / No, but…), Fear higher bends it against you (Yes, but… / No, and…). Doubles answer as normal, then a Random Event occurs.</p>
    </section>

    <section className="solo-panel">
      <h2>Random Event</h2>
      <p className="solo-muted">Oracle doubles and Interrupted scenes roll these for you. Roll one yourself here, or choose the focus that suits the moment.</p>
      <form className="solo-ask" onSubmit={submit => { submit.preventDefault(); void runEvent('duality-event', { focus: focus === '' ? undefined : Number(focus) }); }}>
        <label className="solo-field">Event focus<select value={focus} onChange={change => setFocus(change.target.value)}>
          <option value="">Roll d12</option>
          {EVENT_FOCUS.map((label, index) => <option key={index} value={index + 1}>{index + 1}. {label}</option>)}
        </select></label>
        <button className="daggery-primary" disabled={play.busy}><Icon name="dice" />Generate event</button>
      </form>
      <div aria-live="polite">{event && <ResultCard key={event.id} entry={event} play={play} />}</div>
    </section>

    <section className="solo-panel">
      <h2>Meaning</h2>
      <p className="solo-muted">For details a yes or no cannot give. Each word rolls both Duality Dice: the Hope die picks the row, the Fear die the column (odd A, even B).</p>
      <form className="solo-ask" onSubmit={submit => { submit.preventDefault(); void runMeaning('duality-meaning', { choice, count }); }}>
        <label className="solo-field">Words<select value={choice} onChange={change => setChoice(change.target.value)}>
          {DUALITY_MEANING_CHOICES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          <option value="generic">Generic generator (what it is, what it does, how much)</option>
        </select></label>
        <label className="solo-field">Rolls<select value={count} disabled={choice === 'generic'} onChange={change => setCount(Number(change.target.value))}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <button className="daggery-primary" disabled={play.busy}><Icon name="dice" />Roll meaning</button>
      </form>
      <div aria-live="polite">{meaning && <ResultCard key={meaning.id} entry={meaning} play={play} />}</div>
    </section>
  </div>;
}

const GENERATORS: { id: string; title: string; hint: string; actions: { label: string; kind: string; values?: Record<string, unknown> }[] }[] = [
  { id: 'adversary', title: 'Adversaries in combat', hint: 'When the spotlight passes to the GM, pick the adversary that makes the most sense and roll. A failed Fear Check means it acts for free; a pass spends Fear. After each GM action, roll the chain: it ends the GM turn on the first failed check.',
    actions: [{ label: 'GM spotlight', kind: 'duality-adversary' }, { label: 'Chain: next adversary', kind: 'duality-adversary', values: { chain: true } }] },
  { id: 'npc', title: 'NPC', hint: 'Role, Motive, Attitude, Quirk and a Topic of conversation. Attitude is the first reaction; after that the NPC follows their Motive.',
    actions: [{ label: 'Generate an NPC', kind: 'duality-npc' }] },
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
