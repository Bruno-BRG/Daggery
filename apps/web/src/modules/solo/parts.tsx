/** Pieces every solo play loop shares: the play context, result cards, printed tables and step cards. */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { dualityTable, type SoloEntry, type SoloState } from '@daggery/shared';
import type { Sheet } from '@daggery/shared/daggerheart/types';
import { useDocs } from '../../sync/store';
import { Icon } from '../../components/Icon';

export type Track = (patch: Record<string, unknown>) => Promise<boolean>;
export type Roll = (kind: string, values: Record<string, unknown>) => Promise<SoloEntry | null>;
/** What every tab needs to roll on the server and keep a result. */
export interface Play {
  entries: SoloEntry[]; busy: boolean; roll: Roll; accept: (id: string, interpretation: string) => Promise<boolean>;
  state: SoloState | null; track: Track;
  /** The campaign Fear pool: the engine spends it; action rolls with Fear and the stepper add to it. */
  fear: number;
  /** Runs a bookkeeping step on the server, such as ending the scene. */
  command: (values: Record<string, unknown>) => Promise<boolean>;
}

export const validDie = (value: string, sides: number) => /^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= sides;

export const KIND_LABELS: Record<string, string> = {
  'duality-scene': 'Set the scene', 'duality-oracle': 'Oracle', 'duality-meaning': 'Meaning', 'duality-table': 'Table', 'duality-event': 'Random Event',
  'duality-move': 'GM Move', 'duality-list': 'List roll', 'duality-fear-check': 'Fear Check', 'duality-adversary': 'Adversary', 'duality-npc': 'NPC',
  'duality-plot': 'Plot hook', 'duality-site': 'Site', 'duality-journey': 'Journey', 'duality-encounter': 'Encounter', 'duality-generate': 'Generator',
  'iron-oracle': 'Ask the Oracle', 'iron-progress': 'Progress roll', 'iron-price': 'Pay the Price', journal: 'Note', procedure: 'Procedure',
};

/** Daggerheart tiers by level: 1, 2–4, 5–7, 8–10. */
export const tierFor = (level: number) => level <= 1 ? 1 : level <= 4 ? 2 : level <= 7 ? 3 : 4;

/** Remembers the last result a panel rolled, so it can show it under its button. */
export function useRolled(play: Play) {
  const [id, setId] = useState<string | null>(null);
  const entry = id ? play.entries.find(item => item.id === id) : undefined;
  const run = async (kind: string, values: Record<string, unknown> = {}) => {
    const rolled = await play.roll(kind, values);
    if (rolled) setId(rolled.id);
    return rolled;
  };
  return [entry, run] as const;
}


/** One rolled result. Keeping it in the app's notes is optional: many players write in their own notebook. */
export function ResultCard({ entry, play }: { entry: SoloEntry; play: Play }) {
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
export function landed(entries: (SoloEntry | undefined)[]): Map<string, [number, number][]> {
  const found = new Map<string, [number, number][]>();
  for (const entry of entries) for (const cell of entry?.result.cells ?? []) found.set(cell.table, [...(found.get(cell.table) ?? []), [cell.column, cell.roll]]);
  return found;
}

/** A printed d12 table. Expand it to browse; rolled results open their reference rows. */
export function LookupTable({ id, hits, open = false }: { id: string; hits: Map<string, [number, number][]>; open?: boolean }) {
  const table = dualityTable(id);
  const marks = hits.get(id) ?? [];
  // With several columns, only the cells a roll used are marked, not the whole row.
  const isRow = (row: number) => table.columns.length === 1 && marks.some(([, roll]) => roll === row);
  const isCell = (column: number, row: number) => marks.some(([col, roll]) => col === column && roll === row);
  return <details className="solo-table" open={open || marks.length > 0}>
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

const JourneyContext = createContext<string | null>(null);

/** Keep each step mounted so moving around never discards a draft or its last roll. */
export function Journey({ steps, title, hint, children }: { steps: [string, string][]; title: string; hint: string; children: ReactNode }) {
  const [active, setActive] = useState(steps[0]![0]);
  const index = Math.max(0, steps.findIndex(([id]) => id === active));
  const goTo = (id: string) => {
    setActive(id);
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  };
  useEffect(() => {
    const navigate = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail;
      if (typeof id === 'string' && steps.some(([step]) => step === id)) setActive(id);
    };
    window.addEventListener('solo:step', navigate);
    return () => window.removeEventListener('solo:step', navigate);
  }, [steps]);
  return <JourneyContext.Provider value={active}>
    <div className="solo-journey">
      <nav className="solo-journey-nav" aria-label="Play loop">
        <div className="solo-journey-intro"><Icon name="compass" /><h2>{title}</h2><p>{hint}</p></div>
        <label className="solo-mobile-step">What happens next?
          <select value={active} onChange={event => setActive(event.target.value)}>{steps.map(([id, label], i) => <option key={id} value={id}>{i + 1}. {label}</option>)}</select>
        </label>
        <ol>{steps.map(([id, label], i) => <li key={id}><button type="button" aria-current={active === id ? 'step' : undefined} aria-controls={id} onClick={() => setActive(id)}><b>{String(i + 1).padStart(2, '0')}</b><span>{label}</span><Icon name="chevron" /></button></li>)}</ol>
        <p className="solo-journey-note"><Icon name="feather" />Fiction first. Let the dice surprise you.</p>
      </nav>
      <div className="solo-journey-content">
        {children}
        <nav className="solo-step-pager" aria-label="Adjacent steps">
          <button type="button" disabled={index === 0} onClick={() => goTo(steps[index - 1]![0])}><Icon name="undo" />Previous</button>
          <span>{index + 1} / {steps.length}</span>
          <button type="button" disabled={index === steps.length - 1} onClick={() => goTo(steps[index + 1]![0])}>Next step<Icon name="arrow" /></button>
        </nav>
      </div>
    </div>
  </JourneyContext.Provider>;
}

/** One step of the play loop: what to do, the button, the result, and the tables it uses. */
export function Step({ n, id, title, hint, children, tables }: { n: string; id: string; title: string; hint: ReactNode; children: ReactNode; tables?: ReactNode }) {
  const active = useContext(JourneyContext);
  return <section className={`solo-panel solo-step${tables ? '' : ' solo-step-full'}`} hidden={active !== null && active !== id} id={id} aria-labelledby={`${id}-title`}>
    <div className="solo-step-main">
      <h2 id={`${id}-title`}><span className="solo-step-number">{n}</span>{title}</h2>
      <p className="solo-muted">{hint}</p>
      {children}
    </div>
    {tables && <aside className="solo-step-tables" aria-label={`${title} reference`}><p className="solo-reference-heading"><Icon name="book" />At your fingertips<span>Reference tables</span></p>{tables}</aside>}
  </section>;
}


export function CombatStep({ play, n = '6' }: { play: Play; n?: string }) {
  const { items } = useDocs<Sheet>('sheets');
  const level = Object.values(items)[0]?.level;
  const [tier, setTier] = useState('');
  const [found, encounter] = useRolled(play);
  const [acted, spotlight] = useRolled(play);
  const [loot, rollLoot] = useRolled(play);
  const chosenTier = tier || (level ? String(tierFor(level)) : '');
  return <Step n={n} id="step-combat" title="Adversaries and combat" hint="When trouble is a fight, roll who you face: what the creature is, what it is doing, and its Daggerheart type. Then, each time the spotlight passes to the GM, roll the spotlight; after each GM action, roll the chain."
    tables={<>
      <LookupTable id="adversary-creature" hits={landed([found])} />
      <LookupTable id="adversary-type" hits={landed([found])} />
      <LookupTable id="tactics" hits={landed([acted])} open={false} />
      <LookupTable id="fear-spend" hits={landed([acted])} open={false} />
      <LookupTable id="treasure" hits={landed([loot])} open={false} />
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
    <h3 className="solo-subhead">After the fight</h3>
    <p className="solo-muted">What the fallen carry, and the detail that makes it a story.</p>
    <div className="solo-actions"><button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void rollLoot('duality-generate', { tableId: 'treasure' })}><Icon name="dice" />Roll loot</button></div>
    <div aria-live="polite">{loot && <ResultCard key={loot.id} entry={loot} play={play} />}</div>
  </Step>;
}

