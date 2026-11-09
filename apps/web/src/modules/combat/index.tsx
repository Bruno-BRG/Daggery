import { useMemo, useState } from 'react';
import { useDiceTray } from '../../dice3d';
import { useDocs } from '../../sync/store';
import { AdversaryCard } from './AdversaryCard';
import { CombatLog } from './CombatLog';
import { CountdownPanel } from './CountdownPanel';
import { BudgetBar, EncounterBuilder } from './EncounterBuilder';
import { FearPanel } from './FearPanel';
import {
  budgetOf,
  computeBudget,
  costOf,
  entriesOf,
  fearValue,
  NS,
  newId,
  pcViews,
  sourceOf,
  spotlightOf,
  type CombatDoc,
  type Ctx,
  type LogDoc,
  type AdversarySource,
} from './model';
import { RosterPanel } from './RosterPanel';
import { SpotlightPanel } from './SpotlightPanel';
import { useRole } from '../../useRole';
import { Button, Panel } from './ui';
import './combat.css';

type Tab = 'encounter' | 'builder';

/** Combat tracker: GM Fear, Spotlight, adversary cards, countdowns, PCs and the shared log. */
export default function CombatModule({ author, sceneId, onPlace }: { author: string; sceneId?: string; onPlace?: (id: string, source: AdversarySource) => void }) {
  const { items, set, remove } = useDocs<CombatDoc>(NS);
  const sheets = useDocs<unknown>('sheets');
  const dice = useDiceTray();
  const [role] = useRole();
  const [tab, setTab] = useState<Tab>('encounter');
  const isGM = role === 'GM';

  const ctx = useMemo<Ctx>(
    () => ({
      docs: items,
      set,
      remove,
      author,
      isGM,
      dice,
      log: (event, text, playerText) =>
        set(`log:${newId()}`, { kind: 'log', at: Date.now(), author, event, text, playerText }),
    }),
    [items, set, remove, author, isGM, dice],
  );

  const fear = fearValue(items);
  const spotlight = spotlightOf(items);
  const budgetDoc = budgetOf(items);
  const pcs = useMemo(() => pcViews(sheets.items, items), [sheets.items, items]);
  const adversaries = useMemo(
    () =>
      entriesOf(items, 'adversary')
        .filter(([, doc]) => !sceneId || !doc.sceneId || doc.sceneId === sceneId)
        .sort((a, b) => a[1].addedAt - b[1].addedAt)
        .map(([id, doc]) => ({ id, doc, src: sourceOf(doc.catalogId) })),
    [items, sceneId],
  );
  const countdowns = useMemo(
    () => entriesOf(items, 'countdown').sort((a, b) => a[1].addedAt - b[1].addedAt),
    [items],
  );
  const logs = useMemo(
    () => entriesOf(items, 'log').sort((a, b) => a[1].at - b[1].at),
    [items],
  );
  const passes = useMemo(
    () =>
      logs
        .map(([, entry]) => entry)
        .filter((entry: LogDoc) => entry.event === 'spotlight' && (isGM || entry.playerText !== undefined))
        .slice(-4)
        .reverse(),
    [logs, isGM],
  );

  const party = budgetDoc.partySize ?? Math.max(1, pcs.length);
  const types = adversaries.map((a) => a.src?.type ?? '').filter(Boolean);
  const budget = computeBudget(party, budgetDoc, types);
  const spent = adversaries.reduce((sum, a) => sum + (a.src ? costOf(a.src.type) : 0), 0);

  function clearEncounter() {
    if (adversaries.length === 0) return;
    if (!window.confirm(`Remove the ${adversaries.length} adversar${adversaries.length === 1 ? 'y' : 'ies'} from the encounter?`)) return;
    for (const a of adversaries) ctx.remove(a.id);
  }

  const showBuilder = isGM && tab === 'builder';

  return (
    <div className="daggery-combat"><div className="daggery-combat-layout flex min-h-full flex-col bg-slate-950 text-slate-100">
      <aside className="daggery-combat-controls flex w-full shrink-0 flex-col gap-4 border-b border-slate-800 p-4">
        {isGM && <FearPanel ctx={ctx} fear={fear} />}
        <SpotlightPanel ctx={ctx} pcs={pcs} spotlight={spotlight} passes={passes} />
        <CountdownPanel ctx={ctx} countdowns={countdowns} />
        <RosterPanel ctx={ctx} pcs={pcs} />
        <CombatLog ctx={ctx} entries={logs} />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-4 p-4">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-wide">Combat</h1>
          {isGM && (
            <nav className="flex gap-1" aria-label="Combat sections">
              <TabButton active={tab === 'encounter'} onClick={() => setTab('encounter')}>
                Encounter
              </TabButton>
              <TabButton active={tab === 'builder'} onClick={() => setTab('builder')}>
                Build encounter
              </TabButton>
            </nav>
          )}
          <div className="ml-auto flex items-center gap-2">
            {isGM && adversaries.length > 0 && (
              <Button tone="rose" onClick={clearEncounter}>
                Clear encounter
              </Button>
            )}
            <span className="text-xs text-slate-400">{isGM ? 'Game Master' : 'Player'}</span>
          </div>
        </header>

        {showBuilder ? (
          <EncounterBuilder ctx={ctx} budgetDoc={budgetDoc} budget={budget} spent={spent} sceneId={sceneId} onPlace={onPlace} />
        ) : (
          <>
            {isGM && (
              <Panel title="Encounter budget">
                <BudgetBar budget={budget} spent={spent} />
              </Panel>
            )}
            {adversaries.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
                {isGM
                  ? 'No adversaries in the encounter. Use the "Build encounter" tab to choose the group.'
                  : 'Waiting for the Game Master to build the encounter.'}
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] items-start gap-4">
                {adversaries.map(({ id, doc, src }) => (
                  <div key={id}>{isGM && onPlace && src && <button className="room-combat-find" type="button" onClick={() => onPlace(id, src)}>Find or place on map ↗</button>}<AdversaryCard ctx={ctx} id={id} doc={doc} src={src} /></div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div></div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-3 py-1.5 text-sm ${active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`}
    >
      {children}
    </button>
  );
}
