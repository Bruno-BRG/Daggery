import { useEffect, useMemo, useState } from 'react';
import { getRuleset, hasFeature, rollDice, type DiceRoll, type MythicData, type SoloEntry, type SoloEntryPage, type SoloSnapshot } from '@daggery/shared';
import { api } from '../../api';
import { getActiveCampaign } from '../../campaign-context';
import { Icon } from '../../components/Icon';
import { useDiceTray } from '../../dice3d';
import './solo.css';

type Tab = 'oracle' | 'tables' | 'dice' | 'notes';
type MythicSource = 'oracle' | 'adventureCrafter' | 'locationCrafting' | 'collectedTables';
type Roll = (kind: string, values: Record<string, unknown>) => Promise<SoloEntry | null>;
type Accept = (entry: SoloEntry, interpretation: string) => Promise<void>;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not complete the action.';
const root = () => `/api/campaigns/${encodeURIComponent(getActiveCampaign().id)}/solo`;
const MYTHIC_GROUPS: { source: MythicSource; label: string }[] = [
  { source: 'oracle', label: 'Oracle' },
  { source: 'adventureCrafter', label: 'Adventure Crafter' },
  { source: 'locationCrafting', label: 'Location Crafting' },
  { source: 'collectedTables', label: 'Collected Tables' },
];
const KIND_LABELS: Record<string, string> = { 'mythic-oracle': 'Oracle', 'mythic-meaning': 'Meaning', 'mythic-table': 'Table', journal: 'Note' };

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
  const [notice, setNotice] = useState('');

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
    setBusy(true); setError(''); setNotice('');
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

  async function accept(entry: SoloEntry, interpretation: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ entry: SoloEntry }>(`${root()}/entries/${encodeURIComponent(entry.id)}`, 'PUT', { interpretation });
      setEntries(previous => previous.map(item => item.id === entry.id ? result.entry : item));
      setNotice('Saved to your notes.');
    } catch (value) {
      setError(errorMessage(value));
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
        <p>Ask the oracle, draw from the tables, roll dice, and keep what becomes true.</p>
      </div>
      <button type="button" className="daggery-primary solo-sheet-link" onClick={openSheet}><Icon name="sheet" />Open character sheet</button>
    </header>
    <nav className="solo-tabs" aria-label="Solo sections">
      {([['oracle', 'Oracle'], ['tables', 'Tables'], ['dice', 'Dice'], ['notes', 'Notes']] as [Tab, string][]).map(([id, label]) =>
        <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    {error && <p role="alert" className="solo-alert">{error}</p>}
    {notice && <p role="status" className="solo-notice">{notice}</p>}
    {tab === 'oracle' && <OracleTab mythic={mythic} entries={entries} busy={busy} roll={roll} accept={accept} />}
    {tab === 'tables' && <TablesTab mythic={mythic} busy={busy} roll={roll} />}
    {tab === 'dice' && <DiceTab />}
    {tab === 'notes' && <NotesTab entries={entries} nextCursor={nextCursor} busy={busy} roll={roll} older={older} />}
  </div>;
}

function NotInstalled() {
  return <section className="solo-panel solo-empty-state">
    <Icon name="book" />
    <h2>Oracle tables are not installed</h2>
    <p>Add the oracle table JSON files to the content folder to unlock the oracle and its tables.</p>
  </section>;
}

function OracleTab({ mythic, entries, busy, roll, accept }: { mythic: MythicData | null; entries: SoloEntry[]; busy: boolean; roll: Roll; accept: Accept }) {
  const [question, setQuestion] = useState('');
  const [oddsId, setOddsId] = useState('');
  const [oracleResult, setOracleResult] = useState<SoloEntry | null>(null);
  const [meaningResult, setMeaningResult] = useState<SoloEntry | null>(null);
  const [extraWords, setExtraWords] = useState<string[]>([]);
  const [meaningWords, setMeaningWords] = useState<string[]>([]);

  const oddsRows = useMemo(() => {
    const table = mythic?.oracle?.tables.find(item => item.id === 'ask-the-game-master');
    return [...(table?.entries ?? [])].sort((a, b) => (a.ranges?.exceptionalYes?.[1] ?? 0) - (b.ranges?.exceptionalYes?.[1] ?? 0));
  }, [mythic]);

  useEffect(() => {
    if (oddsId || oddsRows.length === 0) return;
    setOddsId(oddsRows.find(row => row.id === '50-50-or-unknown')?.id ?? oddsRows[Math.floor(oddsRows.length / 2)]?.id ?? '');
  }, [oddsId, oddsRows]);
  useEffect(() => { setExtraWords([]); }, [oracleResult?.id]);
  useEffect(() => { setMeaningWords([]); }, [meaningResult?.id]);

  if (!mythic) return <p className="solo-empty">Loading oracle tables…</p>;
  if (!mythic.available) return <NotInstalled />;

  const recent = entries.filter(entry => entry.kind === 'mythic-oracle').slice(0, 6);

  async function ask() {
    const entry = await roll('mythic-oracle', { question, odds: oddsId });
    if (entry) setOracleResult(entry);
  }
  async function discover() {
    const entry = await roll('mythic-meaning', { count: 1 });
    if (entry) setMeaningResult(entry);
  }
  async function anotherWord(target: SoloEntry | null) {
    const entry = await roll('mythic-meaning', { question: target?.question ?? '', count: 1 });
    if (!entry) return;
    if (target === meaningResult) setMeaningWords(previous => [...previous, entry.result.title]);
    else setExtraWords(previous => [...previous, entry.result.title]);
  }

  return <div className="solo-oracle-layout">
    <div className="solo-stack">
      <form className="solo-panel" onSubmit={event => { event.preventDefault(); void ask(); }}>
        <h2>Ask the oracle</h2>
        <p className="solo-muted">Pick how likely the answer is, then ask a yes/no question.</p>
        <label className="solo-field">Your question
          <input required maxLength={2000} value={question} onChange={event => setQuestion(event.target.value)} placeholder="Is the lighthouse occupied?" />
        </label>
        <fieldset className="solo-odds-field">
          <legend>Odds</legend>
          <div className="solo-segment" role="group" aria-label="Odds">
            {oddsRows.map(row => <button type="button" key={row.id} aria-pressed={oddsId === row.id} onClick={() => { if (row.id) setOddsId(row.id); }}>{row.label}</button>)}
          </div>
        </fieldset>
        <div className="solo-actions">
          <button className="daggery-primary" disabled={busy || !question.trim() || !oddsId}><Icon name="dice" />Ask</button>
          <button type="button" className="daggery-roll-toggle" disabled={busy} onClick={() => void discover()}><Icon name="spark" />Discover Meaning</button>
        </div>
      </form>
      <section className="solo-panel solo-log">
        <h2>Recent oracle</h2>
        {recent.length === 0
          ? <p className="solo-empty">No questions asked yet.</p>
          : <ol className="solo-log-list">{recent.map(entry => <li key={entry.id}>
            <div><strong>{entry.result.title}</strong><span>{entry.question}</span></div>
            <small>d100 {entry.result.total} · {new Date(entry.at).toLocaleTimeString()}</small>
          </li>)}</ol>}
      </section>
    </div>
    <div className="solo-stack">
      {oracleResult
        ? <ResultCard entry={oracleResult} busy={busy} accept={accept} extraWords={extraWords} onRollAnother={() => anotherWord(oracleResult)} />
        : <section className="solo-panel solo-empty-state"><Icon name="dice" /><h2>The oracle waits</h2><p>Ask a question to reveal an answer, and watch for a random event on a double.</p></section>}
      {meaningResult && <ResultCard entry={meaningResult} busy={busy} accept={accept} extraWords={meaningWords} onRollAnother={() => anotherWord(meaningResult)} />}
    </div>
  </div>;
}

function ResultCard({ entry, busy, accept, extraWords, onRollAnother }: { entry: SoloEntry; busy: boolean; accept: Accept; extraWords: string[]; onRollAnother?: () => Promise<void> }) {
  const lines = entry.result.detail.split('\n').filter(line => line.trim());
  const eventLine = lines.find(line => line.startsWith('Random event:'));
  const base = lines.filter(line => !line.startsWith('Random event:'));
  const pair = eventLine?.replace(/^Random event:\s*/, '');
  const wordBlock = !!eventLine || extraWords.length > 0 || entry.kind === 'mythic-meaning';
  return <article className={`solo-panel solo-result tone-${entry.result.tone}`}>
    <p className="solo-kicker">{KIND_LABELS[entry.kind] ?? entry.kind} · {new Date(entry.at).toLocaleTimeString()}</p>
    {entry.question && <p className="solo-question">{entry.question}</p>}
    {entry.result.total !== undefined && <div className="solo-result-meta"><span className="solo-chip">Roll {entry.result.total}</span></div>}
    <h2 className="solo-result-answer">{entry.result.title}</h2>
    {base.length > 0 && <p className="solo-result-detail">{base.join('\n')}</p>}
    {wordBlock && <div className="solo-random-event">
      <p className="solo-kicker">{eventLine ? 'Random event' : 'Discover Meaning'}</p>
      {pair && <p className="solo-word-pair">{pair}</p>}
      {extraWords.length > 0 && <div className="solo-words">{extraWords.map((word, index) => <span className="solo-word" key={index}>{word}</span>)}</div>}
      {onRollAnother && <button type="button" className="daggery-roll-toggle" disabled={busy} onClick={() => void onRollAnother()}><Icon name="dice" />Roll another word</button>}
    </div>}
    <Interpretation entry={entry} busy={busy} accept={accept} />
  </article>;
}

function Interpretation({ entry, busy, accept }: { entry: SoloEntry; busy: boolean; accept: Accept }) {
  const [text, setText] = useState(entry.interpretation);
  useEffect(() => { setText(entry.interpretation); }, [entry.id, entry.interpretation]);
  return <>
    <label className="solo-field solo-interpret-field">Your interpretation
      <textarea rows={3} maxLength={6000} value={text} onChange={event => setText(event.target.value)} placeholder="What does this mean? What happens next?" />
    </label>
    <button type="button" className="daggery-primary" disabled={busy || !text.trim()} onClick={() => void accept(entry, text)}>
      <Icon name="check" />{entry.accepted ? 'Update note' : 'Save to notes'}
    </button>
  </>;
}

function TablesTab({ mythic, busy, roll }: { mythic: MythicData | null; busy: boolean; roll: Roll }) {
  const [columns, setColumns] = useState<Record<string, number>>({});
  const [results, setResults] = useState<Record<string, SoloEntry>>({});
  if (!mythic) return <p className="solo-empty">Loading oracle tables…</p>;
  if (!mythic.available) return <NotInstalled />;

  async function rollTable(source: MythicSource, tableId: string, column?: number) {
    const key = `${source}:${tableId}`;
    const entry = await roll('mythic-table', { source, tableId, ...(column === undefined ? {} : { column }) });
    if (entry) setResults(previous => ({ ...previous, [key]: entry }));
  }

  return <div className="solo-stack">
    {MYTHIC_GROUPS.map(({ source, label }) => {
      const file = mythic[source];
      if (!file || file.tables.length === 0) return null;
      return <section className="solo-panel" key={source}>
        <h2>{label}</h2>
        <div className="solo-table-list">{file.tables.map(table => {
          const key = `${source}:${table.id}`;
          const selected = columns[key] ?? 0;
          const result = results[key];
          return <article className="solo-table-card" key={key}>
            <header>
              <h3>{table.title}</h3>
              <span className="solo-chip">{table.die}</span>
            </header>
            {table.columns && table.columns.length > 1 && <div className="solo-segment solo-segment-small" role="group" aria-label={`${table.title} column`}>
              {table.columns.map((column, index) => <button type="button" key={column} aria-pressed={selected === index} onClick={() => setColumns(previous => ({ ...previous, [key]: index }))}>{column}</button>)}
            </div>}
            <button type="button" className="daggery-roll-toggle" disabled={busy} onClick={() => void rollTable(source, table.id, table.columns && table.columns.length > 1 ? selected : undefined)}>
              <Icon name="dice" />Roll {table.die}
            </button>
            {result && <div className="solo-table-result">
              <strong>{result.result.title}</strong>
              <span>{result.result.detail}</span>
            </div>}
          </article>;
        })}</div>
      </section>;
    })}
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
