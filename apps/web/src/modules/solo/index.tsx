import { useEffect, useMemo, useRef, useState } from 'react';
import { getRuleset, hasFeature, rollDice, type DiceRoll, type MythicData, type MythicRange, type MythicTable, type MythicTableEntry, type MythicTablesFile, type SoloEntry, type SoloEntryPage, type SoloSnapshot, type SoloState, type SoloTrackerItem, SOLO_TRACKER_LIMIT } from '@daggery/shared';
import type { Sheet } from '@daggery/shared/daggerheart/types';
import { armorScore, hpMax, stressMax } from '@daggery/shared/daggerheart';
import { api } from '../../api';
import { useDocs } from '../../sync/store';
import { changeResourceCount } from '../sheets/resource-track';
import { getActiveCampaign } from '../../campaign-context';
import { Icon } from '../../components/Icon';
import { useDiceTray } from '../../dice3d';
import { CHAOS_DEFAULT, CHAOS_MAX, CHAOS_MIN, clampChaos, shiftOddsRows } from './chaos';
import './solo.css';

type Tab = 'scene' | 'oracle' | 'tables' | 'dice' | 'notes';
type Track = (patch: Record<string, unknown>) => Promise<boolean>;
type MythicSource = 'adventureCrafter' | 'locationCrafting' | 'collectedTables';
type Roll = (kind: string, values: Record<string, unknown>) => Promise<SoloEntry | null>;
/** What every tab needs to roll on the server and keep a result. */
interface Play { entries: SoloEntry[]; busy: boolean; roll: Roll; accept: (id: string, interpretation: string) => Promise<boolean>; state: SoloState | null; chaos: number; track: Track }
const ANSWER_KEYS: Record<string, string> = { 'Exceptional Yes': 'exceptionalYes', Yes: 'yes', No: 'no', 'Exceptional No': 'exceptionalNo' };
const inRange = (range: MythicRange | undefined, value: number | undefined) => !!range && value !== undefined && value >= range[0] && value <= range[1];
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not complete the action.';
const root = () => `/api/campaigns/${encodeURIComponent(getActiveCampaign().id)}/solo`;
const CHAOS_KEY = 'daggery:chaos';
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
const KIND_LABELS: Record<string, string> = { 'mythic-scene': 'Scene test', 'mythic-oracle': 'Oracle', 'mythic-meaning': 'Meaning', 'mythic-table': 'Table', journal: 'Note', procedure: 'Procedure' };

const readChaos = () => {
  try {
    const stored = Number(localStorage.getItem(CHAOS_KEY));
    return Number.isInteger(stored) && stored >= CHAOS_MIN && stored <= CHAOS_MAX ? stored : CHAOS_DEFAULT;
  } catch {
    return CHAOS_DEFAULT;
  }
};
const sameRange = (a?: MythicRange, b?: MythicRange) => a?.[0] === b?.[0] && a?.[1] === b?.[1];
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
    setBusy(true); setError('');
    try {
      const { entry } = await api<{ entry: SoloEntry }>(`${root()}/roll`, 'POST', { kind, requestId: crypto.randomUUID(), ...values });
      setEntries(previous => [entry, ...previous.filter(item => item.id !== entry.id)]);
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

  /** Saves part of the tracked state: chaos, scene, threads or characters. */
  async function track(patch: Record<string, unknown>): Promise<boolean> {
    if (!state) return false;
    setBusy(true); setError('');
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

  // Campaigns that never saved a chaos factor start from the one this browser remembered.
  const chaos = state?.chaos ?? readChaos();
  const play: Play = { entries, busy, roll, accept, state, chaos, track };
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

function ChaosPanel({ play }: { play: Play }) {
  const { chaos } = play;
  const set = (value: number) => void play.track({ chaos: clampChaos(value) });
  return <section className="solo-panel solo-chaos-panel" aria-label="Chaos factor">
    <div className="solo-chaos-stepper" role="group" aria-label="Chaos factor">
      <button type="button" aria-label="Decrease chaos" disabled={play.busy || !play.state || chaos <= CHAOS_MIN} onClick={() => set(chaos - 1)}>−</button>
      <span className="solo-chaos-value" aria-live="polite">Chaos <strong>{chaos}</strong></span>
      <button type="button" aria-label="Increase chaos" disabled={play.busy || !play.state || chaos >= CHAOS_MAX} onClick={() => set(chaos + 1)}>+</button>
    </div>
    <p className="solo-chaos-caption">Saved with this campaign. Raise it when a scene slips out of your control, lower it when you stay in control.</p>
  </section>;
}

function SceneTab({ mythic, play }: { mythic: MythicData | null; play: Play }) {
  const scene = play.state!.scene;
  const [title, setTitle] = useState(scene.title);
  const [expected, setExpected] = useState(scene.expected);
  const [testId, setTestId] = useState<string | null>(null);
  const dirty = title.trim() !== scene.title || expected.trim() !== scene.expected;
  const tested = testId ? play.entries.find(entry => entry.id === testId) : undefined;
  const saveScene = () => play.track({ scene: { title: title.trim(), expected: expected.trim() } });

  async function testScene() {
    if (dirty && !(await saveScene())) return;
    const entry = await play.roll('mythic-scene', { question: title.trim() });
    if (entry) setTestId(entry.id);
  }

  return <div className="solo-stack">
    <ChaosPanel play={play} />
    <section className="solo-panel">
      <form onSubmit={event => { event.preventDefault(); void saveScene(); }}>
      <h2>Current scene</h2>
      <p className="solo-muted">Say where you are and what you expect to happen, then test whether the scene goes that way.</p>
      <label className="solo-field">Scene<input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="The eastern gate at dusk" /></label>
      <label className="solo-field">What you expect<textarea rows={2} maxLength={2000} value={expected} onChange={event => setExpected(event.target.value)} placeholder="The keeper lets me through without questions." /></label>
      <div className="solo-actions">
        <button className="daggery-roll-toggle" disabled={play.busy || !dirty}><Icon name="check" />{dirty ? 'Save scene' : 'Scene saved'}</button>
        <button type="button" className="daggery-primary" disabled={play.busy || !mythic?.available} onClick={() => void testScene()}><Icon name="dice" />Test the scene</button>
      </div>
      {mythic && !mythic.available && <p className="solo-muted">The scene test needs the oracle tables, which are not installed.</p>}
      </form>
      <div aria-live="polite">{tested && <ResultCard key={tested.id} entry={tested} play={play} />}</div>
    </section>
    <div className="solo-lists">
      <TrackerList title="Threads" field="threads" empty="No open threads. Add the goals and loose ends you are following." placeholder="Find the missing caravan" play={play} />
      <TrackerList title="Characters" field="characters" empty="No one yet. Add the people and creatures who matter." placeholder="The gate keeper" play={play} />
    </div>
  </div>;
}

function TrackerList({ title, field, empty, placeholder, play }: { title: string; field: 'threads' | 'characters'; empty: string; placeholder: string; play: Play }) {
  const items: SoloTrackerItem[] = play.state?.[field] ?? [];
  const [name, setName] = useState('');
  const full = items.length >= SOLO_TRACKER_LIMIT;
  const save = (next: SoloTrackerItem[]) => play.track({ [field]: next });

  async function add() {
    if (await save([...items, { id: crypto.randomUUID(), name: name.trim(), note: '', done: false }])) setName('');
  }

  return <section className="solo-panel solo-tracker">
    <h2>{title} <span className="solo-chip">{items.filter(item => !item.done).length} open</span></h2>
    {items.length === 0
      ? <p className="solo-empty">{empty}</p>
      : <ul className="solo-tracker-list">{items.map(item => <li key={item.id} className={item.done ? 'is-done' : undefined}>
        <label><input type="checkbox" checked={item.done} disabled={play.busy} onChange={event => void save(items.map(other => other.id === item.id ? { ...other, done: event.target.checked } : other))} /><span>{item.name}</span></label>
        <button type="button" aria-label={`Remove ${item.name}`} disabled={play.busy} onClick={() => void save(items.filter(other => other.id !== item.id))}><Icon name="trash" /></button>
      </li>)}</ul>}
    <form className="solo-tracker-add" onSubmit={event => { event.preventDefault(); void add(); }}>
      <label className="solo-field">Add to {title.toLowerCase()}<input value={name} maxLength={120} disabled={full} onChange={event => setName(event.target.value)} placeholder={placeholder} /></label>
      <button className="daggery-roll-toggle" disabled={play.busy || full || !name.trim()}><Icon name="plus" />Add</button>
    </form>
    {full && <p className="solo-muted">This list is full at {SOLO_TRACKER_LIMIT}. Remove one to add another.</p>}
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
  const { chaos } = play;
  const [question, setQuestion] = useState('');
  const [oddsId, setOddsId] = useState('');
  const [asked, setAsked] = useState<{ id: string; oddsId: string } | null>(null);
  const [meaningId, setMeaningId] = useState<string | null>(null);

  const oddsRows = useMemo(() => {
    const table = mythic?.oracle?.tables.find(item => item.id === 'ask-the-game-master');
    return [...(table?.entries ?? [])].sort((a, b) => (b.ranges?.exceptionalYes?.[1] ?? 0) - (a.ranges?.exceptionalYes?.[1] ?? 0));
  }, [mythic]);
  const meaningRows = useMemo(
    () => mythic?.oracle?.tables.find(item => item.id === 'discover-meaning')?.entries ?? [],
    [mythic],
  );
  const shiftedRows = useMemo(() => shiftOddsRows(oddsRows, chaos), [oddsRows, chaos]);
  const meaningColumns = useMemo(() => chunk(meaningRows, 3), [meaningRows]);

  if (!mythic) return <p className="solo-empty">Loading oracle tables…</p>;
  if (!mythic.available) return <NotInstalled />;

  const shifted = chaos !== CHAOS_DEFAULT;
  const isMid = (row: MythicTableEntry) => row.id === '50-50-or-unknown' || /50\s*\/\s*50/i.test(row.label ?? '');
  const chosenOdds = oddsId || oddsRows.find(isMid)?.id || oddsRows[0]?.id || '';
  const answer = asked ? play.entries.find(entry => entry.id === asked.id) : undefined;
  const meaning = meaningId ? play.entries.find(entry => entry.id === meaningId) : undefined;
  const meaningRoll = meaning ? Number(/d100 (\d+)/.exec(meaning.result.detail)?.[1]) || undefined : undefined;

  async function ask() {
    const entry = await play.roll('mythic-oracle', { question: question.trim(), odds: chosenOdds, chaos });
    if (entry) { setAsked({ id: entry.id, oddsId: chosenOdds }); setQuestion(''); }
  }
  async function discover() {
    const entry = await play.roll('mythic-meaning', { count: 1 });
    if (entry) setMeaningId(entry.id);
  }

  return <div className="solo-stack">
    <ChaosPanel play={play} />

    <section className="solo-panel">
      <h2>Ask the oracle</h2>
      <p className="solo-muted">Ask a yes or no question, choose how likely a yes is, and roll d100.</p>
      <form className="solo-ask" onSubmit={event => { event.preventDefault(); void ask(); }}>
        <label className="solo-field">Question<input value={question} maxLength={2000} onChange={event => setQuestion(event.target.value)} placeholder="Is the gate guarded?" /></label>
        <label className="solo-field">Odds<select aria-label="Odds" value={chosenOdds} onChange={event => setOddsId(event.target.value)}>{oddsRows.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
        <button className="daggery-primary" disabled={play.busy || !question.trim() || !chosenOdds}><Icon name="dice" />Ask the oracle</button>
      </form>
      <div aria-live="polite">{answer && <ResultCard key={answer.id} entry={answer} play={play} />}</div>
      <div className="solo-reference-table solo-oracle-chart-wrap">
        <table className="solo-oracle-chart">
          <thead>
            <tr>
              <th scope="col">Odds</th>
              {RANGE_COLUMNS.map(column => <th scope="col" key={column.key}>
                <span className="solo-col-full">{column.label}</span>
                <span className="solo-col-short">{column.short}</span>
              </th>)}
            </tr>
          </thead>
          <tbody>
            {shiftedRows.map((row, index) => {
              const rolledHere = !!answer && asked?.oddsId === row.id;
              return <tr key={row.id ?? index} className={[isMid(row) ? 'is-mid' : '', rolledHere ? 'is-rolled' : ''].join(' ').trim() || undefined}>
                <th scope="row">{row.label ?? '—'}</th>
                {RANGE_COLUMNS.map(column => {
                  const range = row.ranges?.[column.key];
                  const moved = shifted && !sameRange(range, oddsRows[index]?.ranges?.[column.key]);
                  const hit = rolledHere && ANSWER_KEYS[answer.result.title] === column.key;
                  return <td key={column.key} className={`solo-range${moved ? ' is-shifted' : ''}${hit ? ' is-answer' : ''}`}>{formatRange(range)}</td>;
                })}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <p className="solo-shift-note">{shifted ? 'Accented ranges are shifted by the chaos factor.' : 'Chaos 5 reads the chart as printed. Higher chaos shifts every row toward Yes, lower toward No.'}</p>
    </section>

    <section className="solo-panel">
      <h2>Discover meaning</h2>
      <p className="solo-muted">Roll d100 for an Action and Description pairing, then read it against the scene.</p>
      {meaningRows.length === 0
        ? <p className="solo-empty">The meaning table is unavailable.</p>
        : <>
          <button type="button" className="daggery-primary" disabled={play.busy} onClick={() => void discover()}><Icon name="dice" />Roll meaning</button>
          <div aria-live="polite">{meaning && <ResultCard key={meaning.id} entry={meaning} play={play} />}</div>
          <div className="solo-meaning-grid">
            {meaningColumns.map((group, groupIndex) => <MeaningTable key={groupIndex} rows={group} rolled={meaningRoll} />)}
          </div>
          <div className="solo-meaning-single">
            <MeaningTable rows={meaningRows} rolled={meaningRoll} />
          </div>
        </>}
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
