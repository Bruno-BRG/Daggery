import { useEffect, useState } from 'react';
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

interface ColumnRoll { roll: number; entry: string }
type TableRolls = Record<number, ColumnRoll>;
interface MeaningRoll { hope: number; fear: number; entry: string }

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

function Workspace() {
  const [sectionId, setSectionId] = useState(sectionFromHash);
  // Results live only here: nothing is saved, and switching sections keeps them for the session.
  const [tableRolls, setTableRolls] = useState<Record<string, TableRolls>>({});
  const [meaningRolls, setMeaningRolls] = useState<Record<string, MeaningRoll>>({});

  useEffect(() => {
    const sync = () => setSectionId(sectionFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  function selectSection(id: string) {
    setSectionId(id);
    if (window.location.hash !== `#solo-${id}`) window.history.replaceState(null, '', `#solo-${id}`);
  }

  function rollTable(table: DualityTable, column: number) {
    const roll = rollD12();
    const entry = table.columns[column]!.entries[roll - 1]!;
    setTableRolls(previous => ({ ...previous, [table.id]: { ...previous[table.id], [column]: { roll, entry } } }));
  }

  function rollMeaning(table: DualityTable) {
    const hope = rollD12();
    const fear = rollD12();
    const entry = readDualityMeaning(table.id as DualityMeaningTable, hope, fear);
    setMeaningRolls(previous => ({ ...previous, [table.id]: { hope, fear, entry } }));
  }

  const section = SOLO_SECTIONS.find(item => item.id === sectionId) ?? SOLO_SECTIONS[0]!;

  return <div className="solo-workspace">
    <header className="solo-heading">
      <div className="solo-heading-copy">
        <p className="solo-kicker">{`Duality GME ${DUALITY_ENGINE_VERSION}`}</p>
        <h1>Solo play</h1>
      </div>
    </header>
    <nav className="solo-tabs" aria-label="Solo sections">
      {SOLO_SECTIONS.map(item => <button key={item.id} type="button" aria-current={item.id === sectionId ? 'page' : undefined} onClick={() => selectSection(item.id)}>
        <Icon name={item.icon} /><span>{item.label}</span>
      </button>)}
    </nav>
    <SectionView section={section} tableRolls={tableRolls} meaningRolls={meaningRolls} onRollTable={rollTable} onRollMeaning={rollMeaning} />
  </div>;
}

function SectionView({ section, tableRolls, meaningRolls, onRollTable, onRollMeaning }: {
  section: SoloSection;
  tableRolls: Record<string, TableRolls>;
  meaningRolls: Record<string, MeaningRoll>;
  onRollTable: (table: DualityTable, column: number) => void;
  onRollMeaning: (table: DualityTable) => void;
}) {
  return <section className="solo-section" aria-labelledby={`solo-section-${section.id}`}>
    <header className="solo-section-heading">
      <h2 id={`solo-section-${section.id}`}>{section.label}</h2>
      <p>{section.intro}</p>
    </header>
    {section.id === 'core' && <CoreWidgets />}
    <div className="solo-table-grid">
      {section.tables.map(id => {
        const table = dualityTable(id);
        return MEANING_TABLES.has(id)
          ? <MeaningCard key={id} table={table} rolled={meaningRolls[id]} onRoll={() => onRollMeaning(table)} />
          : <TableCard key={id} table={table} rolls={tableRolls[id] ?? EMPTY_ROLLS} onRoll={column => onRollTable(table, column)} />;
      })}
    </div>
    {section.reference.length > 0 && <div className="solo-reference-grid">
      {section.reference.map(block => <ReferenceBlock key={block.title} block={block} />)}
    </div>}
  </section>;
}

/** One table card: every row visible, one roll button per column. */
function TableCard({ table, rolls, onRoll }: { table: DualityTable; rolls: TableRolls; onRoll: (column: number) => void }) {
  const rolled = table.columns.some((_, column) => rolls[column]);
  return <article className="solo-table-card">
    <header className="solo-card-head">
      <h3>{table.title}</h3>
      {table.columns.length > 1 && <div className="solo-table-actions">
        <button type="button" className="solo-roll-all" onClick={() => table.columns.forEach((_, column) => onRoll(column))}>Roll all</button>
      </div>}
    </header>
    {rolled && <div className="solo-card-result" aria-live="polite">
      {table.columns.map((column, index) => {
        const value = rolls[index];
        return value
          ? <span key={column.label} className="solo-result-chip">{table.columns.length > 1 ? `${column.label}: ` : ''}{value.roll} · {value.entry}</span>
          : null;
      })}
    </div>}
    <div className="solo-table-scroll">
      <table className="solo-table">
        <thead><tr>
          <th scope="col">d12</th>
          {table.columns.map((column, index) => <th scope="col" key={column.label}>
            <span>{column.label}</span>
            <button type="button" className="solo-column-roll" aria-label={`Roll d12 for ${column.label}`} onClick={() => onRoll(index)}>Roll d12</button>
          </th>)}
        </tr></thead>
        <tbody>{Array.from({ length: 12 }, (_, row) => {
          const hits = table.columns.map((_, index) => rolls[index]?.roll === row + 1);
          return <tr key={row} className={hits.some(Boolean) ? 'is-rolled' : undefined}>
            <th scope="row" className="solo-range">{row + 1}</th>
            {table.columns.map((column, index) => <td key={column.label} className={hits[index] ? 'is-answer' : undefined}>{column.entries[row]}</td>)}
          </tr>;
        })}</tbody>
      </table>
    </div>
  </article>;
}

/** Meaning is read with both Duality Dice: Hope picks the row, Fear picks odd/even A/B. */
function MeaningCard({ table, rolled, onRoll }: { table: DualityTable; rolled: MeaningRoll | undefined; onRoll: () => void }) {
  const answerColumn = rolled ? (rolled.fear % 2 === 1 ? 0 : 1) : -1;
  return <article className="solo-table-card solo-meaning-card">
    <header className="solo-card-head">
      <h3>{table.title}</h3>
      <button type="button" className="solo-roll" onClick={onRoll}><Icon name="dice" />Roll Duality Dice</button>
    </header>
    <p className="solo-card-note">Hope die picks the row; Fear die picks the column (odd: A, even: B).</p>
    {rolled && <div className="solo-card-result" aria-live="polite">
      <span className="solo-result-chip">Hope {rolled.hope} · Fear {rolled.fear}</span>
      <strong className="solo-meaning-result">{rolled.entry}</strong>
    </div>}
    <div className="solo-table-scroll">
      <table className="solo-table">
        <thead><tr>
          <th scope="col">d12</th>
          {table.columns.map(column => <th scope="col" key={column.label}>{column.label}</th>)}
        </tr></thead>
        <tbody>{Array.from({ length: 12 }, (_, row) => {
          const isRow = rolled?.hope === row + 1;
          return <tr key={row} className={isRow ? 'is-rolled' : undefined}>
            <th scope="row" className="solo-range">{row + 1}</th>
            {table.columns.map((column, index) => <td key={column.label} className={isRow && index === answerColumn ? 'is-answer' : undefined}>{column.entries[row]}</td>)}
          </tr>;
        })}</tbody>
      </table>
    </div>
  </article>;
}

function ReferenceBlock({ block }: { block: RefBlock }) {
  return <section className="solo-reference-block">
    <h3>{block.title}</h3>
    {block.note && <p className="solo-reference-note">{block.note}</p>}
    <dl>{block.rows.map(([term, detail], index) => <div key={index}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>
  </section>;
}

interface OracleResult { label: string; target: number; hope: number; fear: number; yes: boolean; doubles: boolean }

/** The three rolls the engine runs on: the oracle, the Fear Check and the Duality Dice. */
function CoreWidgets() {
  const [oracle, setOracle] = useState<OracleResult | null>(null);
  const [fear, setFear] = useState(0);
  const [check, setCheck] = useState<{ roll: number; pass: boolean; fear: number } | null>(null);
  const [duality, setDuality] = useState<{ hope: number; fear: number } | null>(null);

  function ask(likelihood: (typeof DUALITY_LIKELIHOODS)[number]) {
    const hope = rollD12();
    const fearDie = rollD12();
    setOracle({ label: likelihood.label, target: likelihood.target, hope, fear: fearDie, yes: hope + fearDie >= likelihood.target, doubles: hope === fearDie });
  }

  function runFearCheck() {
    const roll = rollD12();
    setCheck({ roll, pass: fearCheck(roll, fear), fear });
  }

  return <div className="solo-widgets">
    <section className="solo-widget" aria-labelledby="solo-oracle-title">
      <h3 id="solo-oracle-title">Ask the Oracle</h3>
      <p className="solo-widget-note">Pick how likely a yes is, then roll the Duality Dice. A yes needs the Hope + Fear total shown.</p>
      <div className="solo-likelihoods" role="group" aria-label="Likelihood">
        {DUALITY_LIKELIHOODS.map(likelihood => <button key={likelihood.id} type="button" onClick={() => ask(likelihood)}>
          <span>{likelihood.label}</span><small>{likelihood.target}+ · {likelihood.chance}</small>
        </button>)}
      </div>
      <div className="solo-widget-result" aria-live="polite">
        {oracle
          ? <>
            <strong className={oracle.yes ? 'is-yes' : 'is-no'}>{oracle.yes ? 'Yes' : 'No'}</strong>
            <span>Hope {oracle.hope} + Fear {oracle.fear} = {oracle.hope + oracle.fear} · needs {oracle.target}+ ({oracle.label})</span>
            {oracle.doubles && <em>Doubles: extreme result or a twist</em>}
          </>
          : <span className="solo-widget-idle">No question asked yet.</span>}
      </div>
    </section>

    <section className="solo-widget" aria-labelledby="solo-fear-check-title">
      <h3 id="solo-fear-check-title">Fear Check</h3>
      <p className="solo-widget-note">Roll a d12; the world acts on a result at or under your Fear.</p>
      <div className="solo-fear-stepper" role="group" aria-label="Fear">
        <button type="button" aria-label="Decrease Fear" disabled={fear <= 0} onClick={() => setFear(value => Math.max(0, value - 1))}>−</button>
        <span className="solo-fear-value" aria-live="polite">Fear <strong>{fear}</strong><i> / {DUALITY_MAX_FEAR}</i></span>
        <button type="button" aria-label="Increase Fear" disabled={fear >= DUALITY_MAX_FEAR} onClick={() => setFear(value => Math.min(DUALITY_MAX_FEAR, value + 1))}>+</button>
      </div>
      <button type="button" className="solo-roll" onClick={runFearCheck}><Icon name="dice" />Fear Check</button>
      <div className="solo-widget-result" aria-live="polite">
        {check
          ? <><strong className={check.pass ? 'is-yes' : 'is-no'}>{check.pass ? 'Pass' : 'Fail'}</strong><span>d12: {check.roll} · passes on {check.fear} or less</span></>
          : <span className="solo-widget-idle">Roll to see whether the world acts.</span>}
      </div>
    </section>

    <section className="solo-widget" aria-labelledby="solo-duality-title">
      <h3 id="solo-duality-title">Duality Dice</h3>
      <p className="solo-widget-note">Two d12, one Hope and one Fear. The higher die sets the tone; doubles are a Critical.</p>
      <button type="button" className="solo-roll" onClick={() => setDuality({ hope: rollD12(), fear: rollD12() })}><Icon name="dice" />Roll 2d12</button>
      <div className="solo-widget-result" aria-live="polite">
        {duality
          ? <>
            <strong>{duality.hope === duality.fear ? 'Critical' : duality.hope > duality.fear ? 'with Hope' : 'with Fear'}</strong>
            <span>Hope {duality.hope} · Fear {duality.fear}</span>
          </>
          : <span className="solo-widget-idle">Roll for tone and criticals.</span>}
      </div>
    </section>
  </div>;
}
