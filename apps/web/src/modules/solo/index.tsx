import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import {
  DUALITY_ENGINE_VERSION, DUALITY_LIKELIHOODS, DUALITY_MAX_FEAR, DUALITY_TABLES,
  IRON_MOVE_GROUPS, IRON_MOVES, IRON_OUTCOME_LABELS,
  dualityTable, fearCheck, hasFeature, readDualityMeaning, resolveIronProgress,
  type DualityMeaningTable, type DualityTable, type IronMove, type IronOutcome,
} from '@daggery/shared';
import { getActiveCampaign } from '../../campaign-context';
import { Icon, type IconName } from '../../components/Icon';
import { useMediaQuery } from '../../useMediaQuery';
import { SOLO_SECTIONS, type RefBlock } from './reference';
import { DIFFICULTIES, MOVE_FLOWS, MOVE_GROUP_META, OUTCOME_ORDER, type MoveFlow, type Step } from './workflow';
import { segments, rangeLabel } from './table-reference';
import { MobileReferenceReader } from './reader';
import './solo.css';
import './reader.css';

/** Tables rolled with the Duality Dice instead of a single d12. */
const MEANING_TABLES = new Set<string>(['action', 'subject', 'descriptor']);

/** A uniform die from the platform CSPRNG, with rejection sampling to avoid modulo bias. */
function rollDie(sides: number): number {
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0]!;
    if (value < limit) return (value % sides) + 1;
  }
}
const rollD12 = () => rollDie(12);

/** Every roll gets a number so the same result rolled twice still flashes. */
let rollSequence = Date.now();
const nextRoll = () => ++rollSequence;

// ------------------------------------------------------------------- the roll log

type Tone = 'yes' | 'no' | 'crit' | 'plain';
interface LogEntry {
  n: number; at: number; icon: IconName;
  /** What was rolled: "Ask the Oracle · Likely", "Face Danger", "Pay the Price". */
  title: string;
  /** The answer, big. */
  answer: string;
  tone: Tone;
  /** Named parts of a multi-column result. */
  lines?: readonly (readonly [string, string])[];
  /** The dice, small. */
  detail?: string;
  /** A rule reminder that matters for this result. */
  note?: string;
  /** What to roll next, from the move or table rules. */
  next?: readonly Step[];
}

const LOG_KEY = 'daggery.solo.log';
const FEAR_KEY = 'daggery.solo.fear';
const LOG_LIMIT = 60;

/** The log only lives for this browser session: the story itself stays in the player's notebook. */
function loadSession<T>(key: string, fallback: T): T {
  try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

interface ColumnRoll { roll: number; entry: string; n: number }
type TableRolls = Record<number, ColumnRoll>;
interface MeaningRoll { hope: number; fear: number; entry: string; n: number }
const EMPTY_ROLLS: TableRolls = {};

type Mode = 'moves' | 'tables' | 'rules' | 'oracle';
const MODES: { id: Mode; label: string; icon: IconName }[] = [
  { id: 'moves', label: 'Moves', icon: 'compass' },
  { id: 'tables', label: 'Tables', icon: 'grid' },
  { id: 'rules', label: 'Rules', icon: 'book' },
];

export default function SoloPlay({ author: _author }: { author: string }) {
  const mobile = useMediaQuery('(max-width: 767px)');
  if (!hasFeature(getActiveCampaign().configuration, 'daggerheart.solo') || getActiveCampaign().role !== 'gm') return <p>Solo play is not enabled for this campaign.</p>;
  return mobile ? <MobileReferenceReader /> : <Workspace />;
}

/** Reads `#solo-tables-combat` or `#solo-moves-face-danger` into a mode and a selection. */
function readHash(fallback: Mode = 'moves'): { mode: Mode; id?: string } {
  const match = /^#solo-(moves|tables|rules|oracle)(?:-(.+))?$/.exec(window.location.hash);
  if (match) return { mode: match[1] as Mode, id: match[2] };
  // Older links point straight at a table section, such as #solo-combat.
  const legacy = window.location.hash.replace(/^#solo-/, '');
  if (SOLO_SECTIONS.some(section => section.id === legacy)) return { mode: 'tables', id: legacy };
  return { mode: fallback };
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function Workspace() {
  const initial = useMemo(() => readHash(), []);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [moveId, setMoveId] = useState(initial.mode === 'moves' && IRON_MOVES.some(move => move.id === initial.id) ? initial.id! : 'face-danger');
  const [sectionId, setSectionId] = useState(initial.mode === 'tables' && SOLO_SECTIONS.some(section => section.id === initial.id) ? initial.id! : SOLO_SECTIONS[0]!.id);
  const [query, setQuery] = useState('');
  const [fear, setFear] = useState(() => loadSession(FEAR_KEY, 0));
  const [log, setLog] = useState<LogEntry[]>(() => loadSession(LOG_KEY, []));
  const [tableRolls, setTableRolls] = useState<Record<string, TableRolls>>({});
  const [meaningRolls, setMeaningRolls] = useState<Record<string, MeaningRoll>>({});
  const [moveOutcomes, setMoveOutcomes] = useState<Record<string, { outcome: IronOutcome; n: number }>>({});
  const [dockPulse, setDockPulse] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const dock = useRef<HTMLElement>(null);

  useEffect(() => { try { sessionStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch { /* storage full or blocked */ } }, [log]);
  useEffect(() => { try { sessionStorage.setItem(FEAR_KEY, JSON.stringify(fear)); } catch { /* storage blocked */ } }, [fear]);

  // Links such as #solo-tables-combat or #solo-moves-make-camp open that view.
  useEffect(() => {
    const sync = () => {
      const { mode: next, id } = readHash();
      setMode(next); setQuery('');
      if (next === 'moves' && IRON_MOVES.some(move => move.id === id)) setMoveId(id!);
      if (next === 'tables' && SOLO_SECTIONS.some(section => section.id === id)) setSectionId(id!);
    };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  // "/" jumps to search from anywhere on the page, as in most rules tools.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || event.ctrlKey || event.metaKey || target?.closest('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The dock sticks to the top; the log column sticks just below it.
  useEffect(() => {
    const bar = dock.current, root = bar?.closest<HTMLElement>('.solo-shell');
    if (!bar || !root) return;
    const measure = () => root.style.setProperty('--solo-dock-height', `${bar.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  function setHash(next: string) {
    if (window.location.hash !== next) window.history.replaceState(null, '', next);
  }
  function scrollToWork() {
    document.querySelector('.daggery-main')?.scrollTo({ top: 0 });
  }
  function openMode(next: Mode) {
    setMode(next); setQuery('');
    setHash(next === 'moves' ? `#solo-moves-${moveId}` : next === 'tables' ? `#solo-tables-${sectionId}` : `#solo-${next}`);
    scrollToWork();
  }
  function openMove(id: string) {
    setMode('moves'); setMoveId(id); setQuery(''); setHash(`#solo-moves-${id}`);
  }
  function openSection(id: string) {
    setSectionId(id); setHash(`#solo-tables-${id}`);
  }

  function push(entry: Omit<LogEntry, 'n' | 'at'>) {
    setLog(previous => [{ ...entry, n: nextRoll(), at: Date.now() }, ...previous].slice(0, LOG_LIMIT));
  }

  // ---- the rolls

  function rollTable(id: string, column?: number) {
    const table = dualityTable(id);
    if (MEANING_TABLES.has(id)) { rollMeaningTable(id as DualityMeaningTable); return; }
    const columns = column === undefined ? table.columns.map((_, index) => index) : [column];
    const rolls = columns.map(index => {
      const roll = rollD12();
      return { index, roll, entry: table.columns[index]!.entries[roll - 1]!, n: nextRoll() };
    });
    setTableRolls(previous => {
      const next = { ...previous[id] };
      for (const roll of rolls) next[roll.index] = { roll: roll.roll, entry: roll.entry, n: roll.n };
      return { ...previous, [id]: next };
    });
    const single = rolls.length === 1;
    const title = single && table.columns.length > 1 ? `${table.title} · ${table.columns[rolls[0]!.index]!.label}` : table.title;
    push({
      icon: 'dice', title, tone: 'plain',
      answer: single ? rolls[0]!.entry : rolls.map(roll => roll.entry).join(' · '),
      lines: single ? undefined : rolls.map(roll => [table.columns[roll.index]!.label, roll.entry] as const),
      detail: `d12: ${rolls.map(roll => roll.roll).join(', ')}`,
      note: id === 'iron-price' ? 'A severe price rolls twice. Take the most obvious outcome if one comes to mind first.' : undefined,
      next: id === 'fear-spend' && rolls.some(roll => roll.roll >= 11) ? [{ kind: 'table', table: 'iron-price', label: 'Hard Move: severe price' }] : undefined,
    });
  }

  function meaningRoll(id: DualityMeaningTable): MeaningRoll {
    const hope = rollD12(), fearDie = rollD12();
    const result = { hope, fear: fearDie, entry: readDualityMeaning(id, hope, fearDie), n: nextRoll() };
    setMeaningRolls(previous => ({ ...previous, [id]: result }));
    return result;
  }
  function rollMeaningTable(id: DualityMeaningTable) {
    const result = meaningRoll(id);
    push({ icon: 'book', title: `Meaning · ${dualityTable(id).title}`, answer: result.entry, tone: 'plain', detail: `Hope ${result.hope} picks the row · Fear ${result.fear} is ${result.fear % 2 ? 'odd: A' : 'even: B'}` });
  }
  function rollMeaningPair(first: 'action' | 'descriptor') {
    const a = meaningRoll(first), b = meaningRoll('subject');
    push({
      icon: 'book', title: first === 'action' ? 'Meaning · What happens' : 'Meaning · What it is like', tone: 'plain',
      answer: `${a.entry} + ${b.entry}`,
      detail: `${first === 'action' ? 'Action' : 'Descriptor'} ${a.hope}/${a.fear} · Subject ${b.hope}/${b.fear}`,
      note: 'Take the first reading that fits the scene. Keep it small.',
    });
  }

  function askOracle(likelihood: (typeof DUALITY_LIKELIHOODS)[number]) {
    const hope = rollD12(), fearDie = rollD12();
    const yes = hope + fearDie >= likelihood.target, doubles = hope === fearDie;
    push({
      icon: 'spark', title: `Ask the Oracle · ${likelihood.label}`, tone: doubles ? 'crit' : yes ? 'yes' : 'no',
      answer: doubles ? (yes ? 'Yes, and more' : 'No, and worse') : yes ? 'Yes' : 'No',
      detail: `Hope ${hope} + Fear ${fearDie} = ${hope + fearDie} · needs ${likelihood.target}+`,
      note: doubles ? 'Doubles: an extreme result or a twist.' : undefined,
      next: doubles ? [{ kind: 'meaning', first: 'action' }] : undefined,
    });
  }

  function rollFearCheck() {
    const roll = rollD12(), pass = fearCheck(roll, fear);
    push({
      icon: 'adversary', title: `Fear Check · Fear ${fear}`, tone: pass ? 'no' : 'yes',
      answer: pass ? 'The world acts' : 'All quiet',
      detail: `d12 ${roll} ${pass ? '≤' : '>'} Fear ${fear}${fear === 0 ? ' (always fails at 0)' : ''}`,
      note: pass ? 'In a fight: spend Fear and roll Fear Spend. On the road: spend 1 Fear and roll Danger.' : 'In a fight: a free action from Tactics. On the road: roll Discovery.',
      next: pass
        ? [{ kind: 'table', table: 'fear-spend', label: 'Fear Spend' }, { kind: 'table', table: 'journey', column: 0, label: 'Journey danger' }]
        : [{ kind: 'table', table: 'tactics', label: 'Tactics (free)' }, { kind: 'table', table: 'journey', column: 1, label: 'Journey discovery' }],
    });
  }

  function rollAction(move: IronMove, difficulty: number, modifier: number) {
    const hope = rollD12(), fearDie = rollD12(), total = hope + fearDie + modifier;
    const crit = hope === fearDie, success = crit || total >= difficulty, withHope = crit || hope > fearDie;
    const outcome: IronOutcome = !success ? 'miss' : withHope ? 'strong' : 'weak';
    const kind = crit ? 'Critical success' : `${success ? 'Success' : 'Failure'} with ${withHope ? 'Hope' : 'Fear'}`;
    if (!withHope) setFear(value => Math.min(DUALITY_MAX_FEAR, value + 1));
    const flow = MOVE_FLOWS[move.id];
    setMoveOutcomes(previous => ({ ...previous, [move.id]: { outcome, n: nextRoll() } }));
    push({
      icon: 'dice', title: move.name, tone: crit ? 'crit' : outcome === 'miss' ? 'no' : 'yes',
      answer: IRON_OUTCOME_LABELS[outcome],
      detail: `${kind} · Hope ${hope} + Fear ${fearDie}${modifier ? ` ${modifier > 0 ? '+' : '−'} ${Math.abs(modifier)}` : ''} = ${total} vs ${difficulty}`,
      note: [move[outcome], crit ? 'Gain a Hope and clear a Stress.' : withHope ? 'Gain a Hope.' : 'The world gains a Fear (added to the tracker).',
        !success && !withHope ? 'The world may spend 1 Fear to make the price severe: roll it twice.' : ''].filter(Boolean).join(' '),
      next: flow?.[outcome],
    });
  }

  function rollProgress(move: IronMove, score: number) {
    const c1 = rollDie(10), c2 = rollDie(10);
    const { outcome, match } = resolveIronProgress(score, c1, c2);
    setMoveOutcomes(previous => ({ ...previous, [move.id]: { outcome, n: nextRoll() } }));
    push({
      icon: 'target', title: `${move.name} · progress roll`, tone: outcome === 'miss' ? 'no' : match ? 'crit' : 'yes',
      answer: `${IRON_OUTCOME_LABELS[outcome]}${match ? ', with a match' : ''}`,
      detail: `Score ${score} against ${c1} and ${c2}`,
      note: [move[outcome], match ? (outcome === 'miss' ? 'A match on a miss: a dire turn.' : 'A match on a hit: a favor or a twist in your favor.') : ''].filter(Boolean).join(' '),
      next: MOVE_FLOWS[move.id]?.[outcome],
    });
  }

  function recordOutcome(move: IronMove, outcome: IronOutcome) {
    setMoveOutcomes(previous => ({ ...previous, [move.id]: { outcome, n: nextRoll() } }));
    push({ icon: 'check', title: move.name, tone: outcome === 'miss' ? 'no' : 'yes', answer: IRON_OUTCOME_LABELS[outcome], detail: 'Rolled at the table', note: move[outcome], next: MOVE_FLOWS[move.id]?.[outcome] });
  }

  function openReferenceTable(id: string) {
    const section = SOLO_SECTIONS.find(item => item.tables.includes(id));
    if (!section) return;
    setMode('tables'); setSectionId(section.id); setQuery('');
    setHash(`#solo-tables-${section.id}`); scrollToWork();
  }

  function runStep(step: Step) {
    if (step.kind === 'table') rollTable(step.table, step.column);
    else if (step.kind === 'meaning') rollMeaningPair(step.first);
    else if (step.kind === 'fear-check') rollFearCheck();
    else {
      // The oracle lives in the dock: bring it into view and point at it.
      dock.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
      dock.current?.querySelector<HTMLButtonElement>('.solo-dock-oracle button')?.focus({ preventScroll: true });
      setDockPulse(value => value + 1);
    }
  }

  async function copyLog() {
    const text = [...log].reverse().map(entry => `${entry.title}: ${entry.answer}${entry.detail ? ` (${entry.detail})` : ''}`).join('\n');
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }

  const trimmed = query.trim().toLowerCase();

  return <div className="solo-shell">
    <header className="solo-top">
      <div className="solo-title">
        <p className="solo-kicker">{`Duality GME ${DUALITY_ENGINE_VERSION}`}</p>
        <h1>Solo play</h1>
      </div>
      <nav className="solo-modes" aria-label="Solo views">
        {MODES.map(item => <button key={item.id} type="button" aria-current={!trimmed && mode === item.id ? 'page' : undefined} onClick={() => openMode(item.id)}>
          <Icon name={item.icon} /><span>{item.label}</span>
        </button>)}
      </nav>
      <label className="solo-search">
        <Icon name="search" />
        <input ref={search} type="search" value={query} placeholder="Find a move or table" aria-label="Find a move or table" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} />
        {!query && <kbd aria-hidden="true">/</kbd>}
      </label>
    </header>

    <OracleDock ref={dock} pulse={dockPulse} fear={fear} setFear={setFear} onAsk={askOracle} onMeaning={rollMeaningPair} onFearCheck={rollFearCheck} onPrice={() => rollTable('iron-price')} />

    <div className="solo-body">
      <main className="solo-main">
        {trimmed
          ? <SearchResults query={trimmed} tableRolls={tableRolls} meaningRolls={meaningRolls} onOpenMove={openMove} onRoll={rollTable} />
          : mode === 'moves'
            ? <MovesView moveId={moveId} onSelect={openMove} outcomes={moveOutcomes} onRunStep={runStep} onAction={rollAction} onProgress={rollProgress} onRecord={recordOutcome} />
            : mode === 'tables'
              ? <TablesView sectionId={sectionId} onSection={openSection} tableRolls={tableRolls} meaningRolls={meaningRolls} onRoll={rollTable} onPair={rollMeaningPair} />
              : mode === 'oracle' ? <OracleReference onTable={openReferenceTable} /> : <RulesView />}
      </main>
      <RollLog log={log} onRunStep={runStep} onCopy={copyLog} onClear={() => setLog([])} />
    </div>
  </div>;
}

function OracleReference({ onTable }: { onTable: (id: string) => void }) {
  return <div className="solo-oracle-reference">
    <header><h2>Ask the Oracle</h2><p>Ask a yes or no question. Choose how likely “yes” is, then roll both d12 and add them. Meet the target for yes; below it means no.</p></header>
    <table className="solo-table"><thead><tr><th scope="col">Likelihood</th><th scope="col">Target</th><th scope="col">Chance</th></tr></thead><tbody>
      {DUALITY_LIKELIHOODS.map(item => <tr key={item.id}><th scope="row">{item.label}</th><td>{item.target}+</td><td>{item.chance}</td></tr>)}
    </tbody></table>
    <p className="solo-reference-callout"><strong>Doubles</strong> mean an extreme result or a twist: “yes, and more” or “no, and worse.” Oracle rolls never give Hope or Fear.</p>
    <section><h3>Need meaning?</h3><p>Read an Action + Subject for what happens, or a Descriptor + Subject for what something is like.</p>
      <div className="solo-steps"><button type="button" onClick={() => onTable('action')}><Icon name="book" />Action</button><button type="button" onClick={() => onTable('descriptor')}><Icon name="book" />Descriptor</button><button type="button" onClick={() => onTable('subject')}><Icon name="book" />Subject</button></div>
    </section>
    <section><h3>Fear Check</h3><p>Roll a d12. At or under the world’s current Fear, the world acts. At 0 Fear, the check always fails. Track Fear with your physical notes.</p>
      <div className="solo-steps"><button type="button" onClick={() => onTable('fear-spend')}><Icon name="book" />Fear Spend</button><button type="button" className="is-price" onClick={() => onTable('iron-price')}><Icon name="book" />Pay the Price</button></div>
    </section>
  </div>;
}

// ------------------------------------------------------------------- oracle dock


interface DockProps {
  pulse: number; fear: number; setFear: (update: (value: number) => number) => void;
  onAsk: (likelihood: (typeof DUALITY_LIKELIHOODS)[number]) => void;
  onMeaning: (first: 'action' | 'descriptor') => void;
  onFearCheck: () => void; onPrice: () => void;
}

/** The four things you reach for in every scene, one tap away wherever you are on the page. */
const OracleDock = forwardRef<HTMLElement, DockProps>(function OracleDock({ pulse, fear, setFear, onAsk, onMeaning, onFearCheck, onPrice }, ref) {
  return <section ref={ref} className="solo-dock" aria-label="Oracle and Fear">
    <div key={pulse} className={`solo-dock-group solo-dock-oracle${pulse ? ' is-pulsing' : ''}`} role="group" aria-labelledby="solo-dock-ask">
      <span className="solo-dock-label" id="solo-dock-ask">Ask the Oracle</span>
      <div className="solo-dock-buttons">
        {DUALITY_LIKELIHOODS.map(likelihood => <button key={likelihood.id} type="button" title={`${likelihood.label}: Hope + Fear ${likelihood.target}+ (${likelihood.chance})`} onClick={() => onAsk(likelihood)}>
          <span>{likelihood.label}</span><small>{likelihood.chance}</small>
        </button>)}
      </div>
    </div>
    <div className="solo-dock-group" role="group" aria-labelledby="solo-dock-meaning">
      <span className="solo-dock-label" id="solo-dock-meaning">Meaning</span>
      <div className="solo-dock-buttons">
        <button type="button" title="Action + Subject: what someone wants, or what happens" onClick={() => onMeaning('action')}><span>What happens</span><small>Action + Subject</small></button>
        <button type="button" title="Descriptor + Subject: what something is, or what a place is like" onClick={() => onMeaning('descriptor')}><span>What it is like</span><small>Descriptor + Subject</small></button>
      </div>
    </div>
    <div className="solo-dock-group solo-dock-fear" role="group" aria-labelledby="solo-dock-fear">
      <span className="solo-dock-label" id="solo-dock-fear">Fear</span>
      <div className="solo-dock-buttons">
        <div className="solo-stepper is-fear">
          <button type="button" aria-label="Spend a Fear" disabled={fear <= 0} onClick={() => setFear(value => Math.max(0, value - 1))}><Icon name="minus" /></button>
          <output aria-live="polite" aria-label={`Fear ${fear} of ${DUALITY_MAX_FEAR}`}>{fear}</output>
          <button type="button" aria-label="Gain a Fear" disabled={fear >= DUALITY_MAX_FEAR} onClick={() => setFear(value => Math.min(DUALITY_MAX_FEAR, value + 1))}><Icon name="plus" /></button>
        </div>
        <button type="button" title="d12 at or under the current Fear: the world acts" onClick={onFearCheck}><span>Fear Check</span><small>d12 ≤ {fear}</small></button>
      </div>
    </div>
    <div className="solo-dock-group" role="group" aria-labelledby="solo-dock-price">
      <span className="solo-dock-label" id="solo-dock-price">On a miss</span>
      <div className="solo-dock-buttons">
        <button type="button" className="is-price" onClick={onPrice}><span>Pay the Price</span><small>d12</small></button>
      </div>
    </div>
  </section>;
});

// ------------------------------------------------------------------- moves view

function MovesView({ moveId, onSelect, outcomes, onRunStep, onAction, onProgress, onRecord }: {
  moveId: string; onSelect: (id: string) => void;
  outcomes: Record<string, { outcome: IronOutcome; n: number }>;
  onRunStep: (step: Step) => void;
  onAction: (move: IronMove, difficulty: number, modifier: number) => void;
  onProgress: (move: IronMove, score: number) => void;
  onRecord: (move: IronMove, outcome: IronOutcome) => void;
}) {
  const move = IRON_MOVES.find(item => item.id === moveId) ?? IRON_MOVES[0]!;
  const detail = useRef<HTMLDivElement>(null);
  const select = (id: string) => {
    onSelect(id);
    // On narrow screens the detail sits under the list: bring it up.
    if (window.matchMedia?.('(max-width: 900px)').matches) requestAnimationFrame(() => detail.current?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }));
  };
  return <div className="solo-moves">
    <nav className="solo-move-list" aria-label="Moves">
      {IRON_MOVE_GROUPS.map(group => <section key={group.id} aria-labelledby={`solo-group-${group.id}`}>
        <h2 id={`solo-group-${group.id}`}><Icon name={MOVE_GROUP_META[group.id].icon} />{group.label.replace(/ moves$/, '')}</h2>
        <ul>{IRON_MOVES.filter(item => item.group === group.id).map(item => <li key={item.id}>
          <button type="button" aria-current={item.id === move.id ? 'true' : undefined} onClick={() => select(item.id)}>
            <span>{item.name}</span>
            {MOVE_FLOWS[item.id]?.resolve === 'action' && <small>Roll</small>}
            {MOVE_FLOWS[item.id]?.resolve === 'progress' && <small>Progress</small>}
          </button>
        </li>)}</ul>
      </section>)}
    </nav>
    <div ref={detail} className="solo-move-detail-wrap">
      <MoveDetail key={move.id} move={move} rolled={outcomes[move.id]} onRunStep={onRunStep} onAction={onAction} onProgress={onProgress} onRecord={onRecord} />
    </div>
  </div>;
}

function stepLabel(step: Step): string {
  if (step.kind === 'table') return step.label ?? dualityTable(step.table).title;
  if (step.kind === 'meaning') return step.first === 'action' ? 'What happens' : 'What it is like';
  if (step.kind === 'fear-check') return 'Fear Check';
  return 'Ask the Oracle';
}
const stepIcon = (step: Step): IconName => step.kind === 'oracle' ? 'spark' : step.kind === 'meaning' ? 'book' : step.kind === 'fear-check' ? 'adversary' : 'dice';

function StepChips({ steps, onRun, compact, referenceOnly }: { steps: readonly Step[] | undefined; onRun: (step: Step) => void; compact?: boolean; referenceOnly?: boolean }) {
  if (!steps?.length) return null;
  return <div className={`solo-steps${compact ? ' is-compact' : ''}`}>
    {steps.map((step, index) => <button key={index} type="button" className={step.kind === 'table' && step.table === 'iron-price' ? 'is-price' : undefined} onClick={() => onRun(step)}>
      <Icon name={referenceOnly ? 'book' : stepIcon(step)} />{stepLabel(step)}
    </button>)}
  </div>;
}

function MoveDetail({ move, rolled, onRunStep, onAction, onProgress, onRecord }: {
  move: IronMove; rolled: { outcome: IronOutcome; n: number } | undefined;
  onRunStep: (step: Step) => void;
  onAction: (move: IronMove, difficulty: number, modifier: number) => void;
  onProgress: (move: IronMove, score: number) => void;
  onRecord: (move: IronMove, outcome: IronOutcome) => void;
}) {
  const flow: MoveFlow = MOVE_FLOWS[move.id] ?? { resolve: 'none' };
  const group = IRON_MOVE_GROUPS.find(item => item.id === move.group)!;
  const hasOutcomes = Boolean(move.strong || move.weak || move.miss);
  const outcomes = hasOutcomes && <section className="solo-outcomes" aria-label="Outcomes" data-rolled={rolled?.outcome}>
    {OUTCOME_ORDER.filter(outcome => move[outcome]).map(outcome => <div key={outcome} className={`solo-outcome is-${outcome}${rolled?.outcome === outcome ? ' is-current' : ''}`}>
      <h3>{IRON_OUTCOME_LABELS[outcome]}<small>{outcome === 'strong' ? 'Success with Hope' : outcome === 'weak' ? 'Success with Fear' : 'Failure'}</small></h3>
      <p>{move[outcome]}</p>
      <StepChips steps={flow[outcome]} onRun={onRunStep} compact />
    </div>)}
  </section>;
  return <article className="solo-move" aria-labelledby="solo-move-name">
    <header className="solo-move-head">
      <p className="solo-move-group"><Icon name={MOVE_GROUP_META[move.group].icon} />{group.label}</p>
      <h2 id="solo-move-name">{move.name}</h2>
      <p className="solo-move-trigger">{move.trigger}</p>
      {move.roll && <p className="solo-move-roll"><Icon name="dice" />{move.roll}</p>}
    </header>

    {move.text && <p className="solo-move-text">{move.text}</p>}

    {flow.tools && <section className="solo-move-block" aria-label="Rolls for this move">
      <h3>Roll for this move</h3>
      <StepChips steps={flow.tools} onRun={onRunStep} />
    </section>}

    {flow.resolve === 'action' && <ActionRoller move={move} onAction={onAction} onRecord={onRecord} />}
    {flow.resolve === 'progress' && <ProgressRoller move={move} onProgress={onProgress} onRecord={onRecord} />}

    {outcomes}
  </article>;
}

function Stepper({ label, value, min, max, onChange, format }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; format?: (value: number) => string }) {
  return <div className="solo-stepper" role="group" aria-label={label}>
    <button type="button" aria-label={`Lower ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Icon name="minus" /></button>
    <output aria-live="polite">{format ? format(value) : value}</output>
    <button type="button" aria-label={`Raise ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Icon name="plus" /></button>
  </div>;
}

function RecordOutcome({ move, onRecord }: { move: IronMove; onRecord: (move: IronMove, outcome: IronOutcome) => void }) {
  return <details className="solo-record">
    <summary>Using physical dice?</summary>
    <div>{OUTCOME_ORDER.map(outcome => <button key={outcome} type="button" className={`is-${outcome}`} onClick={() => onRecord(move, outcome)}>{IRON_OUTCOME_LABELS[outcome]}</button>)}</div>
  </details>;
}

function ActionRoller({ move, onAction, onRecord }: { move: IronMove; onAction: (move: IronMove, difficulty: number, modifier: number) => void; onRecord: (move: IronMove, outcome: IronOutcome) => void }) {
  const [difficulty, setDifficulty] = useState(13);
  const [modifier, setModifier] = useState(0);
  const hint = DIFFICULTIES.find(item => item.value === difficulty)?.hint;
  return <section className="solo-roller" aria-label="Action roll">
    <div className="solo-roller-row">
      <div className="solo-field">
        <span className="solo-field-label">Difficulty</span>
        <div className="solo-segmented" role="radiogroup" aria-label="Difficulty">
          {DIFFICULTIES.map(item => <button key={item.value} type="button" role="radio" aria-checked={difficulty === item.value} title={item.hint} onClick={() => setDifficulty(item.value)}>
            <strong>{item.value}</strong><small>{item.label}</small>
          </button>)}
        </div>
      </div>
      <div className="solo-field">
        <span className="solo-field-label">Trait + modifiers</span>
        <Stepper label="modifier" value={modifier} min={-5} max={10} onChange={setModifier} format={value => value > 0 ? `+${value}` : `${value}`} />
      </div>
      <button type="button" className="solo-primary" onClick={() => onAction(move, difficulty, modifier)}><Icon name="dice" />Roll the Duality Dice</button>
    </div>
    <p className="solo-roller-hint">{hint} Lock the Difficulty in before you roll.</p>
    <RecordOutcome move={move} onRecord={onRecord} />
  </section>;
}

function ProgressRoller({ move, onProgress, onRecord }: { move: IronMove; onProgress: (move: IronMove, score: number) => void; onRecord: (move: IronMove, outcome: IronOutcome) => void }) {
  const [score, setScore] = useState(5);
  return <section className="solo-roller" aria-label="Progress roll">
    <div className="solo-roller-row">
      <div className="solo-field">
        <span className="solo-field-label">Full boxes on the track</span>
        <div className="solo-boxes" role="radiogroup" aria-label="Progress score">
          {Array.from({ length: 11 }, (_, value) => <button key={value} type="button" role="radio" aria-checked={score === value} aria-label={`${value} boxes`} className={value > 0 && value <= score ? 'is-filled' : undefined} onClick={() => setScore(value)}>{value === 0 ? '0' : ''}</button>)}
        </div>
      </div>
      <button type="button" className="solo-primary" onClick={() => onProgress(move, score)}><Icon name="target" />Progress roll · {score}</button>
    </div>
    <p className="solo-roller-hint">Your score against two d10. No Hope, Fear or modifiers.</p>
    <RecordOutcome move={move} onRecord={onRecord} />
  </section>;
}

// ------------------------------------------------------------------ tables view

function TablesView({ sectionId, onSection, tableRolls, meaningRolls, onRoll, onPair }: {
  sectionId: string; onSection: (id: string) => void;
  tableRolls: Record<string, TableRolls>; meaningRolls: Record<string, MeaningRoll>;
  onRoll: (id: string, column?: number) => void; onPair: (first: 'action' | 'descriptor') => void;
}) {
  const section = SOLO_SECTIONS.find(item => item.id === sectionId) ?? SOLO_SECTIONS[0]!;
  return <div className="solo-tables">
    <nav className="solo-chips" aria-label="Table groups">
      {SOLO_SECTIONS.map(item => <button key={item.id} type="button" aria-current={item.id === section.id ? 'true' : undefined} onClick={() => onSection(item.id)}>
        <Icon name={item.icon} />{item.label}<small>{item.tables.length}</small>
      </button>)}
    </nav>
    <p className="solo-section-intro">{section.intro}</p>
    {section.id === 'meaning' && <div className="solo-pair-bar">
      <button type="button" className="solo-primary" onClick={() => onPair('action')}><Icon name="dice" />Action + Subject</button>
      <button type="button" className="solo-primary is-quiet" onClick={() => onPair('descriptor')}><Icon name="dice" />Descriptor + Subject</button>
    </div>}
    <div className="solo-card-grid">
      {section.tables.map(id => <TableCard key={id} table={dualityTable(id)} rolls={tableRolls[id] ?? EMPTY_ROLLS} meaning={meaningRolls[id]} onRoll={column => onRoll(id, column)} />)}
    </div>
  </div>;
}

function SearchResults({ query, tableRolls, meaningRolls, onOpenMove, onRoll }: {
  query: string; tableRolls: Record<string, TableRolls>; meaningRolls: Record<string, MeaningRoll>;
  onOpenMove: (id: string) => void; onRoll: (id: string, column?: number) => void;
}) {
  const moves = IRON_MOVES.filter(move => `${move.name} ${move.trigger}`.toLowerCase().includes(query));
  const tables = DUALITY_TABLES.filter(table => `${table.title} ${table.columns.map(column => column.label).join(' ')}`.toLowerCase().includes(query));
  if (!moves.length && !tables.length) return <p className="solo-empty">Nothing matches “{query}”. Try a word from a move or table name, such as camp, price or name.</p>;
  const foundTables = tables.length > 0 && <section aria-labelledby="solo-found-tables">
    <h2 id="solo-found-tables">Tables</h2>
    <div className="solo-card-grid">{tables.map(table => <TableCard key={table.id} table={table} rolls={tableRolls[table.id] ?? EMPTY_ROLLS} meaning={meaningRolls[table.id]} onRoll={column => onRoll(table.id, column)} />)}</div>
  </section>;
  return <div className="solo-search-results">
    {moves.length > 0 && <section aria-labelledby="solo-found-moves">
      <h2 id="solo-found-moves">Moves</h2>
      <div className="solo-found-moves">{moves.map(move => <button key={move.id} type="button" onClick={() => onOpenMove(move.id)}>
        <strong>{move.name}</strong><span>{move.trigger}</span>
      </button>)}</div>
    </section>}
    {foundTables}
  </div>;
}

const within = (segment: ReturnType<typeof segments>[number], roll: number | undefined) => roll !== undefined && roll >= segment.start && roll <= segment.end;

/** A compact card: the latest result up front, the full table one click away. */
function TableCard({ table, rolls, meaning, onRoll }: { table: DualityTable; rolls: TableRolls; meaning: MeaningRoll | undefined; onRoll: (column?: number) => void }) {
  const [open, setOpen] = useState(false);
  const isMeaning = MEANING_TABLES.has(table.id);
  const multi = !isMeaning && table.columns.length > 1;
  const rolledAny = isMeaning ? Boolean(meaning) : table.columns.some((_, index) => rolls[index]);
  return <article className="solo-card" id={`solo-table-${table.id}`}>
    <header className="solo-card-head">
      <div>
        <h3>{table.title}</h3>
        <p>{isMeaning ? 'Duality Dice: Hope picks the row, Fear odd/even picks A/B' : multi ? `d12 per column · ${table.columns.map(column => column.label).join(', ')}` : 'd12'}</p>
      </div>
      <button type="button" className="solo-roll" onClick={() => onRoll()}><Icon name="dice" />Roll</button>
    </header>
    <div className="solo-card-result" aria-live="polite" data-empty={!rolledAny || undefined}>
      {!rolledAny
        ? <span className="solo-result-idle">No roll yet</span>
        : isMeaning
          ? <p key={meaning!.n} className="solo-result-single solo-flash"><strong>{meaning!.entry}</strong><small>Hope {meaning!.hope} · Fear {meaning!.fear}</small></p>
          : multi
            ? <dl className="solo-result-lines">{table.columns.map((column, index) => {
              const value = rolls[index];
              return value ? <div key={`${column.label}-${value.n}`} className="solo-flash"><dt>{column.label}</dt><dd><span className="solo-badge">{value.roll}</span><span>{value.entry}</span></dd></div> : null;
            })}</dl>
            : <p key={rolls[0]!.n} className="solo-result-single solo-flash"><span className="solo-badge">{rolls[0]!.roll}</span><strong>{rolls[0]!.entry}</strong></p>}
    </div>
    <button type="button" className="solo-card-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <Icon name="chevron" />{open ? 'Hide the table' : 'Show the table'}
    </button>
    {open && (isMeaning ? <MeaningTable table={table} rolled={meaning} /> : <FullTable table={table} rolls={rolls} onRoll={onRoll} />)}
  </article>;
}

function FullTable({ table, rolls, onRoll }: { table: DualityTable; rolls: TableRolls; onRoll: (column?: number) => void }) {
  const multi = table.columns.length > 1;
  const columns = table.columns.map(column => segments(column.entries));
  const breaks = columns.map(runs => runs.map(run => run.start).join(','));
  const grouped = breaks.every(value => value === breaks[0]);
  return <div className="solo-table-scroll">
    <table className="solo-table">
      <thead><tr>
        <th scope="col" className="solo-range">d12</th>
        {table.columns.map((column, index) => <th scope="col" key={column.label}>
          {multi ? <button type="button" className="solo-column-roll" aria-label={`Roll d12 for ${column.label}`} onClick={() => onRoll(index)}>{column.label}<Icon name="dice" /></button> : column.label}
        </th>)}
      </tr></thead>
      <tbody>{grouped
        ? columns[0]!.map((segment, row) => {
          const hits = table.columns.map((_, index) => within(columns[index]![row]!, rolls[index]?.roll));
          return <tr key={segment.start} className={hits.some(Boolean) ? 'is-rolled' : undefined}>
            <th scope="row" className="solo-range">{rangeLabel(segment)}</th>
            {table.columns.map((column, index) => <td key={hits[index] ? `${column.label}-${rolls[index]!.n}` : column.label} className={hits[index] ? 'is-answer' : undefined}>{columns[index]![row]!.text}</td>)}
          </tr>;
        })
        : Array.from({ length: 12 }, (_, offset) => {
          const row = offset + 1;
          return <tr key={row} className={table.columns.some((_, index) => rolls[index]?.roll === row) ? 'is-rolled' : undefined}>
            <th scope="row" className="solo-range">{row}</th>
            {table.columns.map((column, index) => {
              const segment = columns[index]!.find(run => run.start === row);
              if (!segment) return null;
              const hit = within(segment, rolls[index]?.roll);
              return <td key={hit ? `${column.label}-${rolls[index]!.n}` : column.label} rowSpan={segment.end - segment.start + 1} className={hit ? 'is-answer' : undefined}>
                {segment.text}{segment.end > segment.start && <small className="solo-cell-range">{rangeLabel(segment)}</small>}
              </td>;
            })}
          </tr>;
        })}</tbody>
    </table>
  </div>;
}

function MeaningTable({ table, rolled }: { table: DualityTable; rolled: MeaningRoll | undefined }) {
  const answerColumn = rolled ? (rolled.fear % 2 === 1 ? 0 : 1) : -1;
  return <div className="solo-table-scroll">
    <table className="solo-table">
      <thead><tr>
        <th scope="col" className="solo-range">Hope</th>
        {table.columns.map(column => <th scope="col" key={column.label}>{column.label}</th>)}
      </tr></thead>
      <tbody>{Array.from({ length: 12 }, (_, row) => {
        const isRow = rolled?.hope === row + 1;
        return <tr key={row} className={isRow ? 'is-rolled' : undefined}>
          <th scope="row" className="solo-range">{row + 1}</th>
          {table.columns.map((column, index) => {
            const hit = isRow && index === answerColumn;
            return <td key={hit ? `${column.label}-${rolled!.n}` : column.label} className={hit ? 'is-answer' : undefined}>{column.entries[row]}</td>;
          })}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

// ------------------------------------------------------------------- rules view

function RulesView() {
  return <div className="solo-rules">
    {SOLO_SECTIONS.filter(section => section.reference.length).map(section => <section key={section.id} aria-labelledby={`solo-rules-${section.id}`}>
      <h2 id={`solo-rules-${section.id}`}><Icon name={section.icon} />{section.label}</h2>
      <div className="solo-reference-grid">{section.reference.map(block => <ReferenceBlock key={block.title} block={block} />)}</div>
    </section>)}
  </div>;
}

function ReferenceBlock({ block }: { block: RefBlock }) {
  return <section className="solo-reference-block">
    <h3>{block.title}</h3>
    {block.note && <p className="solo-reference-note">{block.note}</p>}
    <dl>{block.rows.map(([term, detail], index) => <div key={index}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>
  </section>;
}

// ---------------------------------------------------------------------- the log

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function RollLog({ log, onRunStep, onCopy, onClear }: { log: LogEntry[]; onRunStep: (step: Step) => void; onCopy: () => Promise<boolean>; onClear: () => void }) {
  const [copied, setCopied] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const [latest, ...older] = log;
  return <aside className="solo-log" aria-label="Results">
    <header className="solo-log-head">
      <h2>Results</h2>
      <div>
        <button type="button" disabled={!log.length} onClick={async () => { setCopied(await onCopy()); window.setTimeout(() => setCopied(false), 1400); }} title="Copy every result as text, to paste into your notes"><Icon name={copied ? 'check' : 'copy'} />{copied ? 'Copied' : 'Copy'}</button>
        <button type="button" disabled={!log.length} onClick={onClear} title="Clear the results"><Icon name="trash" /></button>
      </div>
    </header>
    <div className="solo-log-scroll" aria-live="polite">
      {!latest
        ? <div className="solo-log-empty">
          <Icon name="dice" />
          <strong>Envision, then roll.</strong>
          <span>Pick a move on the left, or ask the Oracle above. Every result lands here, newest first, with what to roll next.</span>
        </div>
        : <>
          <LogCard key={latest.n} entry={latest} featured onRunStep={onRunStep} />
          {older.length > 0 && <>
            {/* On narrow screens the results sit above the work: earlier ones fold away. */}
            <button type="button" className="solo-log-more" aria-expanded={showOlder} onClick={() => setShowOlder(value => !value)}>
              <Icon name="chevron" />{showOlder ? 'Hide earlier results' : `Earlier results (${older.length})`}
            </button>
            <ol className="solo-log-list" data-open={showOlder || undefined}>{older.map(entry => <li key={entry.n}><LogCard entry={entry} onRunStep={onRunStep} /></li>)}</ol>
          </>}
        </>}
    </div>
  </aside>;
}

function LogCard({ entry, featured, onRunStep }: { entry: LogEntry; featured?: boolean; onRunStep: (step: Step) => void }) {
  return <article className={`solo-entry is-${entry.tone}${featured ? ' is-featured solo-flash' : ''}`}>
    <header><Icon name={entry.icon} /><span>{entry.title}</span><time dateTime={new Date(entry.at).toISOString()}>{timeFormat.format(entry.at)}</time></header>
    {entry.lines
      ? <dl className="solo-entry-lines">{entry.lines.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>
      : <strong className="solo-entry-answer">{entry.answer}</strong>}
    {entry.detail && <p className="solo-entry-detail">{entry.detail}</p>}
    {featured && entry.note && <p className="solo-entry-note">{entry.note}</p>}
    {featured && entry.next && <div className="solo-entry-next"><span>Next</span><StepChips steps={entry.next} onRun={onRunStep} compact /></div>}
  </article>;
}
