import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  DUALITY_ENGINE_VERSION, DUALITY_LIKELIHOODS, DUALITY_MAX_FEAR,
  dualityTable, fearCheck, hasFeature, readDualityMeaning,
  type DualityMeaningTable, type DualityTable,
} from '@daggery/shared';
import { getActiveCampaign } from '../../campaign-context';
import { Icon } from '../../components/Icon';
import { SOLO_SECTIONS, type RefBlock, type SoloSection } from './reference';
import './solo.css';

/** Tables rolled with the Duality Dice instead of a single d12. */
const MEANING_TABLES = new Set<string>(['action', 'subject', 'descriptor']);

/** A uniform d12 from the platform CSPRNG, with rejection sampling to avoid modulo bias. */
function rollD12(): number {
  const limit = Math.floor(0x1_0000_0000 / 12) * 12;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0]!;
    if (value < limit) return (value % 12) + 1;
  }
}

/** Every roll gets a number so the same result rolled twice still flashes. */
let rollSequence = 0;
const nextRoll = () => ++rollSequence;

interface ColumnRoll { roll: number; entry: string; n: number }
type TableRolls = Record<number, ColumnRoll>;
interface MeaningRoll { hope: number; fear: number; entry: string; n: number }

const EMPTY_ROLLS: TableRolls = {};

export default function SoloPlay({ author: _author }: { author: string }) {
  if (!hasFeature(getActiveCampaign().configuration, 'daggerheart.solo') || getActiveCampaign().role !== 'gm') return <p>Solo play is not enabled for this campaign.</p>;
  return <Workspace />;
}

/** Reads the section id from a hash such as `#solo-combat`. */
function sectionFromHash(): string {
  const id = window.location.hash.replace(/^#solo-/, '');
  return SOLO_SECTIONS.some(section => section.id === id) ? id : SOLO_SECTIONS[0]!.id;
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });

function Workspace() {
  const [sectionId, setSectionId] = useState(sectionFromHash);
  // Results live only here: nothing is saved, and switching sections keeps them for the session.
  const [tableRolls, setTableRolls] = useState<Record<string, TableRolls>>({});
  const [meaningRolls, setMeaningRolls] = useState<Record<string, MeaningRoll>>({});
  const workspace = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    const sync = () => setSectionId(sectionFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  // On phones the section bar scrolls sideways: keep the current section in view.
  useEffect(() => {
    const bar = nav.current, active = bar?.querySelector<HTMLElement>('[aria-current]');
    if (!bar || !active) return;
    const box = bar.getBoundingClientRect(), tab = active.getBoundingClientRect();
    if (tab.left < box.left || tab.right > box.right) bar.scrollTo({ left: bar.scrollLeft + tab.left - box.left - 12 });
  }, [sectionId]);

  // The sticky section bar changes height when it wraps; jump targets stop just below it.
  useLayoutEffect(() => {
    const bar = nav.current, root = workspace.current;
    if (!bar || !root) return;
    const measure = () => root.style.setProperty('--solo-nav-height', `${bar.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  function selectSection(id: string) {
    setSectionId(id);
    if (window.location.hash !== `#solo-${id}`) window.history.replaceState(null, '', `#solo-${id}`);
    // Only jump when the reader has scrolled past the top of the section.
    const heading = document.getElementById('solo-section-top');
    const navBottom = nav.current?.getBoundingClientRect().bottom ?? 0;
    if (heading && heading.getBoundingClientRect().top < navBottom) heading.scrollIntoView({ block: 'start' });
  }

  function rollTable(table: DualityTable, column: number) {
    const roll = rollD12();
    const entry = table.columns[column]!.entries[roll - 1]!;
    const n = nextRoll();
    setTableRolls(previous => ({ ...previous, [table.id]: { ...previous[table.id], [column]: { roll, entry, n } } }));
  }

  function rollMeaning(id: DualityMeaningTable): MeaningRoll {
    const hope = rollD12();
    const fear = rollD12();
    const result = { hope, fear, entry: readDualityMeaning(id, hope, fear), n: nextRoll() };
    setMeaningRolls(previous => ({ ...previous, [id]: result }));
    return result;
  }

  const section = SOLO_SECTIONS.find(item => item.id === sectionId) ?? SOLO_SECTIONS[0]!;

  return <div className="solo-workspace" ref={workspace}>
    <header className="solo-heading">
      <p className="solo-kicker">{`Duality GME ${DUALITY_ENGINE_VERSION}`}</p>
      <h1>Solo play</h1>
    </header>
    <nav className="solo-tabs" aria-label="Solo sections" ref={nav}>
      {SOLO_SECTIONS.map(item => <button key={item.id} type="button" aria-current={item.id === sectionId ? 'page' : undefined} onClick={() => selectSection(item.id)}>
        <Icon name={item.icon} /><span>{item.label}</span>
      </button>)}
    </nav>
    <SectionView key={section.id} section={section} tableRolls={tableRolls} meaningRolls={meaningRolls} onRollTable={rollTable} onRollMeaning={rollMeaning} />
  </div>;
}

function SectionView({ section, tableRolls, meaningRolls, onRollTable, onRollMeaning }: {
  section: SoloSection;
  tableRolls: Record<string, TableRolls>;
  meaningRolls: Record<string, MeaningRoll>;
  onRollTable: (table: DualityTable, column: number) => void;
  onRollMeaning: (id: DualityMeaningTable) => MeaningRoll;
}) {
  const tables = section.tables.map(id => dualityTable(id));
  return <section className="solo-section" aria-labelledby={`solo-section-${section.id}`}>
    <header className="solo-section-heading" id="solo-section-top">
      <h2 id={`solo-section-${section.id}`}>{section.label}</h2>
      <p>{section.intro}</p>
      <div className="solo-jump" role="group" aria-label={`Jump to a table in ${section.label}`}>
        {tables.map(table => <button key={table.id} type="button" onClick={() => scrollToId(`solo-table-${table.id}`)}>{table.title}</button>)}
        {section.reference.length > 0 && <button type="button" className="is-rules" onClick={() => scrollToId(`solo-rules-${section.id}`)}><Icon name="book" />Rules</button>}
      </div>
    </header>
    {section.id === 'core' && <CoreWidgets />}
    {section.id === 'meaning' && <MeaningCombos onRoll={onRollMeaning} />}
    <div className="solo-table-grid">
      {tables.map(table => MEANING_TABLES.has(table.id)
        ? <MeaningCard key={table.id} table={table} rolled={meaningRolls[table.id]} onRoll={() => onRollMeaning(table.id as DualityMeaningTable)} />
        : <TableCard key={table.id} table={table} rolls={tableRolls[table.id] ?? EMPTY_ROLLS} onRoll={column => onRollTable(table, column)} />)}
    </div>
    {section.reference.length > 0 && <section className="solo-rules" id={`solo-rules-${section.id}`} aria-labelledby={`solo-rules-title-${section.id}`}>
      <h2 id={`solo-rules-title-${section.id}`}>Rules at a glance</h2>
      <div className="solo-reference-grid">{section.reference.map(block => <ReferenceBlock key={block.title} block={block} />)}</div>
    </section>}
  </section>;
}

// ------------------------------------------------------------------- table cards

interface Segment { start: number; end: number; text: string }
/** Runs of identical rows: the printed ranges such as 1–2 or 3–5. Rows are 1-based. */
function segments(entries: readonly string[]): Segment[] {
  const runs: Segment[] = [];
  entries.forEach((text, index) => {
    const last = runs[runs.length - 1];
    if (last && last.text === text) last.end = index + 1;
    else runs.push({ start: index + 1, end: index + 1, text });
  });
  return runs;
}
const rangeLabel = ({ start, end }: Segment) => start === end ? `${start}` : `${start}–${end}`;
const within = (segment: Segment, roll: number | undefined) => roll !== undefined && roll >= segment.start && roll <= segment.end;

function RollBadge({ value }: { value: number }) {
  return <span className="solo-badge" aria-hidden="true">{value}</span>;
}

/** One table card: every row visible, ranges merged as printed, one roll per column. */
function TableCard({ table, rolls, onRoll }: { table: DualityTable; rolls: TableRolls; onRoll: (column: number) => void }) {
  const multi = table.columns.length > 1;
  const columns = table.columns.map(column => segments(column.entries));
  const breaks = columns.map(runs => runs.map(run => run.start).join(','));
  // When every column breaks on the same rows, the d12 column itself shows the ranges.
  const grouped = breaks.every(value => value === breaks[0]);
  const rolledAny = table.columns.some((_, index) => rolls[index]);
  const rollAll = () => table.columns.forEach((_, index) => onRoll(index));

  return <article className="solo-table-card" id={`solo-table-${table.id}`}>
    <header className="solo-card-head">
      <h3>{table.title}</h3>
      <button type="button" className="solo-roll" onClick={multi ? rollAll : () => onRoll(0)}><Icon name="dice" />{multi ? 'Roll all' : 'Roll d12'}</button>
    </header>
    <div className="solo-card-result" aria-live="polite" data-empty={!rolledAny || undefined}>
      {!rolledAny
        ? <span className="solo-result-idle">{multi ? 'Roll all, or tap a column to roll it alone.' : 'Roll a d12.'}</span>
        : multi
          ? <dl className="solo-result-lines">{table.columns.map((column, index) => {
            const value = rolls[index];
            return value ? <div key={`${column.label}-${value.n}`} className="solo-flash"><dt>{column.label}</dt><dd><RollBadge value={value.roll} /><span>{value.entry}</span></dd></div> : null;
          })}</dl>
          : <p key={rolls[0]!.n} className="solo-result-single solo-flash"><RollBadge value={rolls[0]!.roll} /><strong>{rolls[0]!.entry}</strong></p>}
    </div>
    <div className="solo-table-scroll">
      <table className="solo-table">
        <thead><tr>
          <th scope="col" className="solo-range">d12</th>
          {table.columns.map((column, index) => <th scope="col" key={column.label}>
            {multi
              ? <button type="button" className="solo-column-roll" title="Roll this column" aria-label={`Roll d12 for ${column.label}`} onClick={() => onRoll(index)}>{column.label}<Icon name="dice" /></button>
              : column.label}
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
            const rolledRow = table.columns.some((_, index) => rolls[index]?.roll === row);
            return <tr key={row} className={rolledRow ? 'is-rolled' : undefined}>
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
    </div>
  </article>;
}

/** Meaning is read with both Duality Dice: Hope picks the row, Fear picks odd/even A/B. */
function MeaningCard({ table, rolled, onRoll }: { table: DualityTable; rolled: MeaningRoll | undefined; onRoll: () => void }) {
  const answerColumn = rolled ? (rolled.fear % 2 === 1 ? 0 : 1) : -1;
  return <article className="solo-table-card" id={`solo-table-${table.id}`}>
    <header className="solo-card-head">
      <h3>{table.title}</h3>
      <button type="button" className="solo-roll" onClick={onRoll}><Icon name="dice" />Roll Duality Dice</button>
    </header>
    <div className="solo-card-result" aria-live="polite" data-empty={!rolled || undefined}>
      {rolled
        ? <p key={rolled.n} className="solo-result-single solo-flash"><strong>{rolled.entry}</strong><small>Hope {rolled.hope} picks the row · Fear {rolled.fear} is {rolled.fear % 2 === 1 ? 'odd: A' : 'even: B'}</small></p>
        : <span className="solo-result-idle">Hope die picks the row; Fear die picks the column (odd: A, even: B).</span>}
    </div>
    <div className="solo-table-scroll">
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
    </div>
  </article>;
}

/** The two pairs the manual reads together: what happens, and what something is. */
function MeaningCombos({ onRoll }: { onRoll: (id: DualityMeaningTable) => MeaningRoll }) {
  const [pair, setPair] = useState<{ first: MeaningRoll; second: MeaningRoll; firstId: DualityMeaningTable } | null>(null);
  const roll = (firstId: DualityMeaningTable) => setPair({ firstId, first: onRoll(firstId), second: onRoll('subject') });
  return <div className="solo-widgets solo-widgets-pair">
    <section className="solo-widget" aria-labelledby="solo-combo-title">
      <h3 id="solo-combo-title">Roll a pair</h3>
      <p className="solo-widget-note">Action + Subject for what someone wants or what happens. Descriptor + Subject for what something is.</p>
      <div className="solo-combo-buttons">
        <button type="button" className="solo-roll" onClick={() => roll('action')}><Icon name="dice" />Action + Subject</button>
        <button type="button" className="solo-roll" onClick={() => roll('descriptor')}><Icon name="dice" />Descriptor + Subject</button>
      </div>
    </section>
    <section className="solo-widget solo-widget-answer" aria-live="polite">
      {pair
        ? <div key={pair.first.n} className="solo-flash">
          <strong className="solo-pair">{pair.first.entry} <span>+</span> {pair.second.entry}</strong>
          <small>{pair.firstId === 'action' ? 'Action' : 'Descriptor'}: Hope {pair.first.hope}, Fear {pair.first.fear} · Subject: Hope {pair.second.hope}, Fear {pair.second.fear}</small>
        </div>
        : <span className="solo-widget-idle">Your pair shows here, and both tables below light up.</span>}
    </section>
  </div>;
}

function ReferenceBlock({ block }: { block: RefBlock }) {
  return <section className="solo-reference-block">
    <h3>{block.title}</h3>
    {block.note && <p className="solo-reference-note">{block.note}</p>}
    <dl>{block.rows.map(([term, detail], index) => <div key={index}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>
  </section>;
}

// ------------------------------------------------------------------ core widgets

interface OracleResult { label: string; target: number; hope: number; fear: number; yes: boolean; doubles: boolean; n: number }

/** The three rolls the engine runs on: the oracle, the Fear Check and the Duality Dice. */
function CoreWidgets() {
  const [oracle, setOracle] = useState<OracleResult | null>(null);
  const [fear, setFear] = useState(0);
  const [check, setCheck] = useState<{ roll: number; pass: boolean; fear: number; n: number } | null>(null);
  const [duality, setDuality] = useState<{ hope: number; fear: number; n: number } | null>(null);

  function ask(likelihood: (typeof DUALITY_LIKELIHOODS)[number]) {
    const hope = rollD12();
    const fearDie = rollD12();
    setOracle({ label: likelihood.label, target: likelihood.target, hope, fear: fearDie, yes: hope + fearDie >= likelihood.target, doubles: hope === fearDie, n: nextRoll() });
  }

  return <div className="solo-widgets">
    <section className="solo-widget solo-oracle" aria-labelledby="solo-oracle-title">
      <h3 id="solo-oracle-title">Ask the Oracle</h3>
      <p className="solo-widget-note">Pick how likely a yes is. Hope + Fear must reach the target.</p>
      <div className="solo-likelihoods" role="group" aria-label="Likelihood">
        {DUALITY_LIKELIHOODS.map(likelihood => <button key={likelihood.id} type="button" aria-pressed={oracle?.label === likelihood.label} onClick={() => ask(likelihood)}>
          <span>{likelihood.label}</span><small>{likelihood.target}+ · {likelihood.chance}</small>
        </button>)}
      </div>
      <div className="solo-widget-result" aria-live="polite">
        {oracle
          ? <div key={oracle.n} className="solo-flash">
            <strong className={oracle.yes ? 'is-yes' : 'is-no'}>{oracle.yes ? 'Yes' : 'No'}{oracle.doubles && <em>, and doubles</em>}</strong>
            <span>Hope {oracle.hope} + Fear {oracle.fear} = {oracle.hope + oracle.fear} · {oracle.label} needs {oracle.target}+</span>
            {oracle.doubles && <span className="solo-twist">Doubles: an extreme result or a twist.</span>}
          </div>
          : <span className="solo-widget-idle">Ask a yes/no question, then pick its likelihood.</span>}
      </div>
    </section>

    <section className="solo-widget" aria-labelledby="solo-fear-check-title">
      <h3 id="solo-fear-check-title">Fear Check</h3>
      <p className="solo-widget-note">Set the Fear you have, then roll a d12. At or under your Fear, the world acts.</p>
      <div className="solo-fear-stepper" role="group" aria-label="Current Fear">
        <button type="button" aria-label="Decrease Fear" disabled={fear <= 0} onClick={() => setFear(value => Math.max(0, value - 1))}>−</button>
        <span className="solo-fear-value" aria-live="polite"><small>Fear</small><strong>{fear}</strong><i>/ {DUALITY_MAX_FEAR}</i></span>
        <button type="button" aria-label="Increase Fear" disabled={fear >= DUALITY_MAX_FEAR} onClick={() => setFear(value => Math.min(DUALITY_MAX_FEAR, value + 1))}>+</button>
      </div>
      <button type="button" className="solo-roll" onClick={() => { const roll = rollD12(); setCheck({ roll, pass: fearCheck(roll, fear), fear, n: nextRoll() }); }}><Icon name="dice" />Fear Check</button>
      <div className="solo-widget-result" aria-live="polite">
        {check
          ? <div key={check.n} className="solo-flash"><strong className={check.pass ? 'is-no' : 'is-yes'}>{check.pass ? 'The world acts' : 'All quiet'}</strong><span>d12 {check.roll} against Fear {check.fear}{check.fear === 0 ? ' (always fails at 0)' : ''}</span></div>
          : <span className="solo-widget-idle">No check rolled yet.</span>}
      </div>
    </section>

    <section className="solo-widget" aria-labelledby="solo-duality-title">
      <h3 id="solo-duality-title">Duality Dice</h3>
      <p className="solo-widget-note">Two d12: Hope and Fear. The higher die sets the tone; doubles are a Critical.</p>
      <button type="button" className="solo-roll" onClick={() => setDuality({ hope: rollD12(), fear: rollD12(), n: nextRoll() })}><Icon name="dice" />Roll 2d12</button>
      <div className="solo-widget-result" aria-live="polite">
        {duality
          ? <div key={duality.n} className="solo-flash">
            <strong className={duality.hope === duality.fear ? 'is-crit' : duality.hope > duality.fear ? 'is-yes' : 'is-no'}>{duality.hope === duality.fear ? 'Critical' : duality.hope > duality.fear ? 'With Hope' : 'With Fear'}</strong>
            <span className="solo-dice-pair"><b className="is-hope">{duality.hope}</b> Hope · <b className="is-fear">{duality.fear}</b> Fear · total {duality.hope + duality.fear}</span>
          </div>
          : <span className="solo-widget-idle">Roll for an action without the full sheet.</span>}
      </div>
    </section>
  </div>;
}
