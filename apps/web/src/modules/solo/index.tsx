import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DUALITY_ENGINE_VERSION, DUALITY_LIKELIHOODS, IRON_MOVE_GROUPS, IRON_MOVES, IRON_OUTCOME_LABELS, isLodestarMove,
  dualityTable, hasFeature, lodestarTable, type IronMove, type IronMoveGroup, type LodestarGroup,
} from '@daggery/shared';
import { getActiveCampaign } from '../../campaign-context';
import { Notes } from '../../CampaignSections';
import { Group, ItemCard, PanelSection, SearchField, TONES } from '../../components/Accordion';
import { Icon, type IconName } from '../../components/Icon';
import { SOLO_SECTIONS, type RefBlock, type SoloSection } from './reference';
import { DIFFICULTIES, MOVE_FLOWS, MOVE_GROUP_META, OUTCOME_ORDER, type Step } from './workflow';
import { ReferenceTableCard } from './table-reference';
import { LODESTAR_GROUPS, LodestarTableCard, lodestarTablesIn } from './lodestar-reference';
import { Rich } from './rich';
import './solo.css';

/**
 * The solo panel, after Stargazer's: ORACLES, MOVES and JOURNAL. It is a printed reference,
 * like the book: every table is shown in full, and each move prints the tables it uses.
 * Nothing here rolls; dice belong to the character sheet and the dice tray.
 */
type PanelPart = 'oracles' | 'moves' | 'journal';
const PANEL_PARTS: readonly { id: PanelPart; label: string }[] = [
  { id: 'oracles', label: 'Oracles' },
  { id: 'moves', label: 'Moves' },
  { id: 'journal', label: 'Journal' },
];
const PANEL_KEY = 'daggery.solo.panel.v3';
type PanelState = Record<PanelPart, boolean> & { groups: string[] };
const PANEL_DEFAULT: PanelState = { oracles: true, moves: false, journal: false, groups: ['ask'] };
function loadPanel(): PanelState {
  try { const raw = localStorage.getItem(PANEL_KEY); return raw ? { ...PANEL_DEFAULT, ...JSON.parse(raw) as Partial<PanelState> } : PANEL_DEFAULT; } catch { return PANEL_DEFAULT; }
}

/** Mounted by the app shell for solo campaigns; stays mounted while closed so open groups survive page changes. */
export default function SoloCompanion({ open }: { open: boolean; onClose: () => void }) {
  if (!hasFeature(getActiveCampaign().configuration, 'daggerheart.solo') || getActiveCampaign().role !== 'gm') return null;
  return <SoloPanel open={open} />;
}

/** `#solo-moves-face-danger` opens a move; `#solo-tables-combat` (or the older `#solo-combat`) opens an oracle group. */
function readHash(): { move?: string; group?: string } {
  const match = /^#solo-(moves|tables)-(.+)$/.exec(window.location.hash);
  if (match?.[1] === 'moves' && IRON_MOVES.some(move => move.id === match[2])) return { move: match[2] };
  if (match?.[1] === 'tables' && (SOLO_SECTIONS.some(section => section.id === match[2]) || LODESTAR_GROUPS.some(group => `lodestar-${group.id}` === match[2]))) return { group: match[2] };
  const legacy = window.location.hash.replace(/^#solo-/, '');
  if (SOLO_SECTIONS.some(section => section.id === legacy)) return { group: legacy };
  return {};
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const toggleIn = (list: readonly string[], id: string) => list.includes(id) ? list.filter(item => item !== id) : [...list, id];

function SoloPanel({ open }: { open: boolean }) {
  const initial = useMemo(() => readHash(), []);
  const [panel, setPanel] = useState<PanelState>(() => {
    const saved = loadPanel();
    if (initial.group) return { ...saved, oracles: true, groups: [...new Set([...saved.groups, initial.group])] };
    if (initial.move) return { ...saved, moves: true };
    return saved;
  });
  const [openMoves, setOpenMoves] = useState<string[]>(initial.move ? [initial.move] : []);
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => { try { localStorage.setItem(PANEL_KEY, JSON.stringify(panel)); } catch { /* storage blocked */ } }, [panel]);

  function scrollPanelTo(id: string) {
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }));
  }
  function revealMove(id: string) {
    setPanel(previous => ({ ...previous, moves: true }));
    setOpenMoves(previous => previous.includes(id) ? previous : [...previous, id]);
    setQuery('');
    scrollPanelTo(`solo-move-${id}`);
  }
  function revealGroup(id: string) {
    setPanel(previous => ({ ...previous, oracles: true, groups: previous.groups.includes(id) ? previous.groups : [...previous.groups, id] }));
    scrollPanelTo(`solo-oracles-${id}`);
  }

  // Links such as #solo-tables-combat or #solo-moves-make-camp open that part of the panel.
  useEffect(() => {
    const sync = () => { const { move, group } = readHash(); if (move) revealMove(move); if (group) revealGroup(group); };
    window.addEventListener('hashchange', sync);
    if (initial.move) revealMove(initial.move); else if (initial.group) revealGroup(initial.group);
    return () => window.removeEventListener('hashchange', sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "/" jumps to the move search while the panel shows, as in most rules tools.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!openRef.current || event.key !== '/' || event.ctrlKey || event.metaKey || target?.closest('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      setPanel(previous => previous.moves ? previous : { ...previous, moves: true });
      requestAnimationFrame(() => search.current?.focus());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const part = (id: PanelPart, body: ReactNode) => {
    const meta = PANEL_PARTS.find(item => item.id === id)!;
    return <PanelSection id={`solo-part-${id}`} className={`solo-part solo-part-${id}`} title={meta.label}
      open={panel[id]} onToggle={() => setPanel(previous => ({ ...previous, [id]: !previous[id] }))}>{body}</PanelSection>;
  };
  const group = (id: string, title: string, icon: IconName, body: ReactNode, count?: number) =>
    <Group key={id} id={`solo-oracles-${id}`} title={title} icon={icon} count={count}
      open={panel.groups.includes(id)} onToggle={() => setPanel(previous => ({ ...previous, groups: toggleIn(previous.groups, id) }))}>{body}</Group>;

  return <aside className="solo-shell solo-panel" aria-label="Oracles, moves and journal" hidden={!open}>
    {part('oracles', <>
      {group('ask', 'Ask the Oracle', 'spark', <AskTheOracle />)}
      {SOLO_SECTIONS.filter(section => section.tables.length).map(section => group(section.id, section.label, section.icon, <OracleTables section={section} />, section.tables.length))}
      {LODESTAR_GROUPS.map(item => group(`lodestar-${item.id}`, `Ironsworn d100: ${item.label}`, LODESTAR_ICONS[item.id], <LodestarTables group={item.id} />, lodestarTablesIn(item.id).length))}
      <p className="solo-panel-credit">{`Duality GME ${DUALITY_ENGINE_VERSION}`} · d100 oracles from Ironsworn Lodestar by Shawn Tomkin (CC BY-NC-SA 4.0)</p>
    </>)}

    {part('moves', <>
      <SearchField inputRef={search} value={query} onChange={setQuery} label="Search moves (press /)" />
      <MoveList query={query.trim().toLowerCase()} openMoves={openMoves} onToggle={id => setOpenMoves(previous => toggleIn(previous, id))} />
      {group('rules', 'Rules reference', 'book', <RulesView />)}
    </>)}

    {part('journal', <Notes embedded />)}
  </aside>;
}

// ------------------------------------------------------------------- oracles

const D100_ODDS = [11, 26, 51, 76, 91] as const;

function AskTheOracle() {
  return <div className="solo-oracle-reference">
    <p>Ask a yes or no question. Choose how likely “yes” is, roll both d12 and add them. Meet the target for yes; below it means no.</p>
    <table className="solo-table"><thead><tr><th scope="col">Likelihood</th><th scope="col">Target</th><th scope="col">Chance</th></tr></thead><tbody>
      {DUALITY_LIKELIHOODS.map(item => <tr key={item.id}><th scope="row">{item.label}</th><td>{item.target}+</td><td>{item.chance}</td></tr>)}
    </tbody></table>
    <p className="solo-printed-intro">Ironsworn’s d100 odds, for the same likelihoods: {DUALITY_LIKELIHOODS.map((item, index) => `${item.label} ${D100_ODDS[index]}+`).join(', ')}. In Duality GME, roll the Duality Dice instead.</p>
    <p className="solo-reference-callout"><strong>Doubles</strong> mean an extreme result or a twist: “yes, and more” or “no, and worse.” Oracle rolls never give Hope or Fear.</p>
    <section><h3>Need meaning?</h3><p>Read an Action + Subject for what happens, or a Descriptor + Subject for what something is like. The tables are under Meaning.</p></section>
    <section><h3>Fear Check</h3><p>Roll a d12. At or under the world’s current Fear, the world acts. At 0 Fear, the check always fails.</p></section>
  </div>;
}

const LODESTAR_ICONS: Record<LodestarGroup, IconName> = {
  moves: 'dice', prompt: 'spark', place: 'map', settlement: 'home', character: 'users', names: 'tag', turning: 'target',
};
/** The Ironsworn Lodestar d100 tables, as printed. Roll a d100 in the dice tray: it throws a tens die and a units die. */
function LodestarTables({ group }: { group: LodestarGroup }) {
  return <div className="solo-printed">
    <p className="solo-printed-intro">Roll a d100 in the dice tray (a tens die and a units die). 00 is 100. If a result is a poor fit, check the row above or below, or reverse the digits (37 becomes 73).</p>
    {lodestarTablesIn(group).map(table => <LodestarTableCard key={table.id} table={table} headingLevel={3} />)}
  </div>;
}

function OracleTables({ section }: { section: SoloSection }) {
  return <div className="solo-printed">
    <p className="solo-printed-intro">{section.intro}</p>
    {section.tables.map(id => <ReferenceTableCard key={id} table={dualityTable(id)} headingLevel={3} />)}
  </div>;
}

// ------------------------------------------------------------------- moves

/** Each move group keeps one colour, from the shared tones. */
const MOVE_TONES: Record<IronMoveGroup, string> = {
  session: TONES.teal, quest: TONES.gold, adventure: TONES.blue, exploration: TONES.green,
  connection: TONES.pink, scene: TONES.violet, combat: TONES.red, suffer: TONES.orange, fate: TONES.fear,
};

function MoveList({ query, openMoves, onToggle }: { query: string; openMoves: readonly string[]; onToggle: (id: string) => void }) {
  const moves = query
    ? IRON_MOVES.filter(move => `${move.name} ${move.trigger} ${move.text ?? ''}`.toLowerCase().includes(query))
    : IRON_MOVES;
  if (!moves.length) return <p className="sg-empty">No move matches “{query}”. Try a word such as camp, vow or price.</p>;
  return <div className="solo-move-accordions">
    {moves.map(move => {
      const group = IRON_MOVE_GROUPS.find(item => item.id === move.group)!;
      const resolve = MOVE_FLOWS[move.id]?.resolve;
      return <ItemCard key={move.id} id={`solo-move-${move.id}`} title={move.name} tone={MOVE_TONES[move.group]} icon={MOVE_GROUP_META[move.group].icon}
        caption={`${group.label.replace(/ moves$/, '')}${resolve === 'action' ? ' · Action roll' : resolve === 'progress' ? ' · Progress roll' : ''}${isLodestarMove(move) ? ' · Ironsworn' : ''}`}
        open={openMoves.includes(move.id)} onToggle={() => onToggle(move.id)}>
        <MoveDetail move={move} />
      </ItemCard>;
    })}
  </div>;
}

/** What a step points at, said in words: no buttons, the tables are printed below. */
function stepText(step: Step): string {
  if (step.kind === 'table') return step.label ?? dualityTable(step.table).title;
  if (step.kind === 'lodestar') return step.label ?? lodestarTable(step.table).title;
  if (step.kind === 'meaning') return step.first === 'action' ? 'Action + Subject' : 'Descriptor + Subject';
  if (step.kind === 'fear-check') return 'Fear Check';
  return 'Ask the Oracle';
}

/** The tables a move uses, each once: its own tables, then the meaning tables it asks for. */
function moveTables(move: IronMove): string[] {
  const flow = MOVE_FLOWS[move.id];
  const steps = [...(flow?.tools ?? []), ...OUTCOME_ORDER.flatMap(outcome => flow?.[outcome] ?? [])];
  const ids = steps.flatMap(step => step.kind === 'table' ? [step.table] : step.kind === 'meaning' ? [step.first, 'subject'] : []);
  return [...new Set(ids)];
}

/** The Lodestar d100 tables a move uses, each once. */
function moveLodestarTables(move: IronMove): string[] {
  const flow = MOVE_FLOWS[move.id];
  const steps = [...(flow?.tools ?? []), ...OUTCOME_ORDER.flatMap(outcome => flow?.[outcome] ?? [])];
  return [...new Set(steps.flatMap(step => step.kind === 'lodestar' ? [step.table] : []))];
}

function MoveDetail({ move }: { move: IronMove }) {
  const flow = MOVE_FLOWS[move.id] ?? { resolve: 'none' as const };
  const tables = moveTables(move);
  const d100Tables = moveLodestarTables(move);
  const usesOracle = [...(flow.tools ?? []), ...OUTCOME_ORDER.flatMap(outcome => flow[outcome] ?? [])].some(step => step.kind === 'oracle' || step.kind === 'fear-check');
  return <article className="solo-move">
    <p className="solo-move-trigger"><Rich text={move.trigger} self={move.id} /></p>
    {move.roll && <p className="solo-move-roll"><Icon name="dice" /><span><Rich text={move.roll} self={move.id} /></span></p>}
    {move.text && <p className="solo-move-text"><Rich text={move.text} self={move.id} /></p>}
    {flow.tools && <p className="solo-move-uses"><strong>Uses:</strong> {flow.tools.map(stepText).join(', ')}</p>}

    {flow.resolve === 'action' && <section className="solo-move-block" aria-label="Difficulty">
      <h3>Difficulty</h3>
      <table className="solo-table solo-difficulty"><tbody>
        {DIFFICULTIES.map(item => <tr key={item.value}><th scope="row">{item.value}</th><td><strong>{item.label}</strong> · {item.hint}</td></tr>)}
      </tbody></table>
    </section>}

    {OUTCOME_ORDER.some(outcome => move[outcome]) && <section className="solo-outcomes" aria-label="Outcomes">
      {OUTCOME_ORDER.filter(outcome => move[outcome]).map(outcome => <div key={outcome} className={`solo-outcome is-${outcome}`}>
        <h3>{IRON_OUTCOME_LABELS[outcome]}<small>{outcome === 'strong' ? 'Success with Hope' : outcome === 'weak' ? 'Success with Fear' : 'Failure'}</small></h3>
        <p><Rich text={move[outcome]!} self={move.id} /></p>
        {flow[outcome]?.length ? <p className="solo-move-uses"><strong>Then:</strong> {flow[outcome]!.map(stepText).join(', ')}</p> : null}
      </div>)}
    </section>}

    {usesOracle && <p className="solo-move-uses">Ask the Oracle and the Fear Check are under <strong>Oracles › Ask the Oracle</strong>.</p>}
    {(tables.length > 0 || d100Tables.length > 0) && <section className="solo-move-tables" aria-label="Tables for this move">
      {tables.map(id => <ReferenceTableCard key={id} table={dualityTable(id)} headingLevel={3} />)}
      {d100Tables.map(id => <LodestarTableCard key={id} table={lodestarTable(id)} headingLevel={3} />)}
    </section>}
  </article>;
}

// ------------------------------------------------------------------- rules

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
