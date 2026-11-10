import { useEffect, useMemo, useState } from 'react';
import { getRuleset, hasFeature, rollDice, type DiceRoll, type MythicData, type MythicRange, type MythicTable, type MythicTableEntry, type MythicTablesFile, type SoloEntry, type SoloEntryPage, type SoloSnapshot } from '@daggery/shared';
import { api } from '../../api';
import { getActiveCampaign } from '../../campaign-context';
import { Icon } from '../../components/Icon';
import { useDiceTray } from '../../dice3d';
import { CHAOS_DEFAULT, CHAOS_MAX, CHAOS_MIN, clampChaos, shiftOddsRows } from './chaos';
import './solo.css';

type Tab = 'oracle' | 'tables' | 'dice' | 'notes';
type MythicSource = 'adventureCrafter' | 'locationCrafting' | 'collectedTables';
type Roll = (kind: string, values: Record<string, unknown>) => Promise<SoloEntry | null>;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not complete the action.';
const root = () => `/api/campaigns/${encodeURIComponent(getActiveCampaign().id)}/solo`;
const CHAOS_KEY = 'daggery:chaos';
const RANGE_COLUMNS = [
  { key: 'exceptionalYes', label: 'Exceptional Yes' },
  { key: 'yes', label: 'Yes' },
  { key: 'no', label: 'No' },
  { key: 'exceptionalNo', label: 'Exceptional No' },
] as const;
const TABLE_GROUPS: { source: MythicSource; label: string }[] = [
  { source: 'adventureCrafter', label: 'Adventure Crafter' },
  { source: 'locationCrafting', label: 'Location Crafting' },
  { source: 'collectedTables', label: 'Collected Tables' },
];
const KIND_LABELS: Record<string, string> = { 'mythic-oracle': 'Oracle', 'mythic-meaning': 'Meaning', 'mythic-table': 'Table', journal: 'Note' };

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
  const [tab, setTab] = useState<Tab>('oracle');
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

  const openSheet = () => window.dispatchEvent(new CustomEvent('daggery:navigate', { detail: 'sheets' }));

  return <div className="solo-workspace">
    <header className="solo-heading">
      <div>
        <p className="solo-kicker">{getRuleset(campaign.configuration)?.name} · Solo</p>
        <h1><Icon name="spark" />Solo play</h1>
        <p>Read the oracle charts, browse the tables, roll dice, and keep what becomes true.</p>
      </div>
      <button type="button" className="daggery-primary solo-sheet-link" onClick={openSheet}><Icon name="sheet" />Open character sheet</button>
    </header>
    <nav className="solo-tabs" aria-label="Solo sections">
      {([['oracle', 'Oracle'], ['tables', 'Tables'], ['dice', 'Dice'], ['notes', 'Notes']] as [Tab, string][]).map(([id, label]) =>
        <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    {error && <p role="alert" className="solo-alert">{error}</p>}
    {tab === 'oracle' && <OracleTab mythic={mythic} />}
    {tab === 'tables' && <TablesTab mythic={mythic} />}
    {tab === 'dice' && <DiceTab />}
    {tab === 'notes' && <NotesTab entries={entries} nextCursor={nextCursor} busy={busy} roll={roll} older={older} />}
  </div>;
}

function NotInstalled() {
  return <section className="solo-panel solo-empty-state">
    <Icon name="book" />
    <h2>Oracle tables are not installed</h2>
    <p>Add the oracle table JSON files to the content folder to unlock the oracle reference.</p>
  </section>;
}

function OracleTab({ mythic }: { mythic: MythicData | null }) {
  const [chaos, setChaos] = useState(readChaos);

  useEffect(() => {
    try { localStorage.setItem(CHAOS_KEY, String(chaos)); } catch { /* storage may be unavailable */ }
  }, [chaos]);

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

  return <div className="solo-stack">
    <section className="solo-panel solo-chaos-panel" aria-label="Chaos factor">
      <div className="solo-chaos-stepper" role="group" aria-label="Chaos factor">
        <button type="button" aria-label="Decrease chaos" disabled={chaos <= CHAOS_MIN} onClick={() => setChaos(value => clampChaos(value - 1))}>−</button>
        <span className="solo-chaos-value" aria-live="polite">Chaos <strong>{chaos}</strong></span>
        <button type="button" aria-label="Increase chaos" disabled={chaos >= CHAOS_MAX} onClick={() => setChaos(value => clampChaos(value + 1))}>+</button>
      </div>
      <p className="solo-chaos-caption">Chaos 5 = chart as printed. Higher chaos shifts every row toward Yes; lower shifts toward No.</p>
    </section>

    <section className="solo-panel">
      <h2>Ask the oracle</h2>
      <p className="solo-muted">Find your odds, then read across for the answer.</p>
      <div className="solo-reference-table solo-oracle-chart-wrap">
        <table className="solo-oracle-chart">
          <thead>
            <tr>
              <th scope="col">Odds</th>
              {RANGE_COLUMNS.map(column => <th scope="col" key={column.key}>{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {shiftedRows.map((row, index) => {
              const mid = row.id === '50-50-or-unknown' || /50\s*\/\s*50/i.test(row.label ?? '');
              return <tr key={row.id ?? index} className={mid ? 'is-mid' : undefined}>
                <th scope="row">{row.label ?? '—'}</th>
                {RANGE_COLUMNS.map(column => {
                  const range = row.ranges?.[column.key];
                  const moved = shifted && !sameRange(range, oddsRows[index]?.ranges?.[column.key]);
                  return <td key={column.key} className={moved ? 'solo-range is-shifted' : 'solo-range'}>{formatRange(range)}</td>;
                })}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {shifted && <p className="solo-shift-note">Accented ranges are shifted by the chaos factor.</p>}
    </section>

    <section className="solo-panel">
      <h2>Discover meaning</h2>
      <p className="solo-muted">Roll d100 and read the Action and Description pairing.</p>
      {meaningRows.length === 0
        ? <p className="solo-empty">The meaning table is unavailable.</p>
        : <div className="solo-meaning-grid">
          {meaningColumns.map((group, groupIndex) => <div className="solo-reference-table" key={groupIndex}>
            <table className="solo-meaning-table">
              <thead>
                <tr><th scope="col">Range</th><th scope="col">Action</th><th scope="col">Description</th></tr>
              </thead>
              <tbody>
                {group.map((entry, index) => <tr key={entry.range?.join('-') ?? index}>
                  <td className="solo-range">{formatRange(entry.range)}</td>
                  <td>{entry.cells?.[0] ?? entry.text ?? '—'}</td>
                  <td>{entry.cells?.[1] ?? ''}</td>
                </tr>)}
              </tbody>
            </table>
          </div>)}
        </div>}
    </section>
  </div>;
}

function TablesTab({ mythic }: { mythic: MythicData | null }) {
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

  return <div className="solo-stack">
    {groups.map((group, groupIndex) => <section className="solo-tables-group" key={group.source} aria-labelledby={`solo-group-${group.source}`}>
      <h2 id={`solo-group-${group.source}`}>{group.label}</h2>
      <div className="solo-table-stack">
        {group.tables.map(table => <details className="solo-table" key={`${group.source}:${table.id}`} open={groupIndex === 0 ? true : undefined}>
          <summary>
            <span className="solo-table-title">{table.title}</span>
            <span className="solo-chip">{table.die}</span>
          </summary>
          <TableBody table={table} />
        </details>)}
      </div>
    </section>)}
  </div>;
}

function TableBody({ table }: { table: MythicTable }) {
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
        {table.entries.map((entry: MythicTableEntry, index) => <tr key={entry.range?.join('-') ?? index}>
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

function DiceTab() {
  const { replay } = useDiceTray();
  const [notation, setNotation] = useState('1d20');
  const [result, setResult] = useState<DiceRoll | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function perform(value: string) {
    setError(''); setBusy(true);
    try {
      const rolled = rollDice(value);
      setResult(rolled);
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
      </div>}
    </section>
  </div>;
}

function NotesTab({ entries, nextCursor, busy, roll, older }: { entries: SoloEntry[]; nextCursor: string | null; busy: boolean; roll: Roll; older: () => Promise<void> }) {
  const [note, setNote] = useState('');
  const accepted = entries.filter(entry => entry.accepted);

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
      {accepted.length === 0
        ? <p className="solo-empty">Your saved notes and accepted interpretations appear here.</p>
        : <ul className="solo-note-list">{accepted.map(entry => <li key={entry.id}>
          <strong>{entry.question || entry.result.title}</strong>
          <small>{KIND_LABELS[entry.kind] ?? entry.kind} · {new Date(entry.at).toLocaleString()}</small>
          {entry.kind !== 'journal' && entry.interpretation && <p className="solo-interpretation">{entry.interpretation}</p>}
        </li>)}</ul>}
      {nextCursor && <button type="button" className="daggery-roll-toggle" disabled={busy} onClick={() => void older()}>Load older notes</button>}
      <p className="solo-muted">{entries.length} saved results loaded.</p>
    </section>
  </div>;
}
