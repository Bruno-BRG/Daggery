import { useMemo, useState } from 'react';
import {
  CATALOG,
  costOf,
  newId,
  NO_CONDITIONS,
  signed,
  TYPE_ORDER,
  toInt,
  type AdversarySource,
  type Budget,
  type BudgetDoc,
  type Ctx,
} from './model';
import { Badge, Button, Panel } from './ui';

const PAGE = 60;

/** Live budget bar: spent Battle Points against the budget. Shown in the GM view only. */
export function BudgetBar({ budget, spent }: { budget: Budget; spent: number }) {
  const over = spent > budget.total;
  const pct = budget.total > 0 ? Math.min(100, (spent / budget.total) * 100) : 100;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-slate-400">Battle points</span>
        <span className={`font-semibold tabular-nums ${over ? 'text-rose-300' : 'text-slate-200'}`}>
          {spent} / {budget.total}
          <span className="ml-2 font-normal text-slate-500">{over ? `${spent - budget.total} over` : `${budget.total - spent} left`}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800" role="meter" aria-valuemin={0} aria-valuemax={budget.total} aria-valuenow={spent}>
        <div className={`h-full transition-all ${over ? 'bg-rose-500' : 'bg-accent-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Battle Points calculator and catalog picker. Adding a card here spends points from the budget. */
export function EncounterBuilder({
  ctx,
  budgetDoc,
  budget,
  spent,
  sceneId,
  onPlace,
}: {
  ctx: Ctx;
  budgetDoc: BudgetDoc;
  budget: Budget;
  spent: number;
  sceneId?: string;
  onPlace?: (id: string, source: AdversarySource) => void;
}) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [tier, setTier] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return CATALOG.filter(
      (a) =>
        (!needle || a.name.toLowerCase().includes(needle)) &&
        (!type || a.type === type) &&
        (!tier || String(a.tier) === tier),
    ).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }, [query, type, tier]);

  const setBudget = (patch: Partial<BudgetDoc>) => ctx.set('budget', { ...budgetDoc, ...patch, kind: 'budget' });

  function add(src: AdversarySource) {
    const minion = src.type === 'Minion';
    const id = `adv:${newId()}`;
    ctx.set(id, {
      kind: 'adversary',
      sceneId,
      catalogId: src.id,
      name: src.name,
      addedAt: Date.now(),
      hpMarked: 0,
      stressMarked: 0,
      groupSize: minion ? budget.party : null,
      defeated: 0,
      conditions: { ...NO_CONDITIONS },
      counters: [],
    });
    onPlace?.(id, src);
  }

  return (
    <div className="daggery-encounter-builder grid gap-4">
      <Panel title="Battle point calculator">
        <div className="flex flex-col gap-3 text-xs">
          <label className="flex items-center justify-between gap-2 text-slate-400">
            PCs in combat
            <input
              type="number"
              min={1}
              value={budgetDoc.partySize ?? ''}
              placeholder={`${budget.party} (roster)`}
              onChange={(event) => {
                const parsed = toInt(event.target.value);
                setBudget({ partySize: parsed === null ? null : Math.max(1, parsed) });
              }}
              className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 tabular-nums text-slate-100"
            />
          </label>

          <div className="rounded-lg bg-slate-950/60 p-2 tabular-nums">
            <div className="flex justify-between text-slate-300">
              <span>
                Base: 3 × {budget.party} PCs + 2
              </span>
              <span>{budget.base}</span>
            </div>
            {budget.lines.map((line) => (
              <div key={line.label} className="flex justify-between text-slate-400">
                <span>
                  {line.label}
                  {line.auto && <span className="ml-1 text-xs text-slate-600">auto</span>}
                </span>
                <span className={line.points < 0 ? 'text-emerald-300' : 'text-rose-300'}>{signed(line.points)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-slate-800 pt-1 font-semibold text-slate-100">
              <span>Budget</span>
              <span>{budget.total}</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Toggle label="Easier or shorter fight (−1)" checked={budgetDoc.easier} onChange={(easier) => setBudget({ easier })} />
            <Toggle
              label="+1d4 (or +2) to everyone’s damage (−2)"
              checked={budgetDoc.plusDamage}
              onChange={(plusDamage) => setBudget({ plusDamage })}
            />
            <Toggle
              label="Lower-tier adversary (+1)"
              checked={budgetDoc.lowerTier}
              onChange={(lowerTier) => setBudget({ lowerTier })}
            />
            <Toggle
              label="More dangerous or longer fight (+2)"
              checked={budgetDoc.dangerous}
              onChange={(dangerous) => setBudget({ dangerous })}
            />
          </div>

          <BudgetBar budget={budget} spent={spent} />

          <div className="text-xs leading-relaxed text-slate-500">
            Cost by type: {TYPE_ORDER.map((t) => `${t} ${costOf(t)}`).join(' · ')}. A group of Minions costs 1 BP.
          </div>
        </div>
      </Panel>

      <Panel title="Adversary catalog">
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE);
            }}
            placeholder="Search by name"
            aria-label="Search adversaries"
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
          />
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            aria-label="Type"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
          >
            <option value="">All types</option>
            {TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={tier}
            onChange={(event) => setTier(event.target.value)}
            aria-label="Tier"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
          >
            <option value="">All tiers</option>
            {[1, 2, 3, 4].map((t) => (
              <option key={t} value={t}>
                Tier {t}
              </option>
            ))}
          </select>
        </div>

        <p className="mb-2 text-xs text-slate-500">
          {filtered.length} adversar{filtered.length === 1 ? 'y' : 'ies'}. {spent > budget.total ? 'Encounter over budget.' : ''}
        </p>

        <ul className="flex flex-col gap-1.5">
          {filtered.slice(0, limit).map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-100">{a.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                  <Badge tone="sky">{a.type}</Badge>
                  <span>Tier {a.tier}</span>
                  <span>Dif {a.difficulty}</span>
                  <span>HP {a.hp}</span>
                  {a.stress !== null && <span>Stress {a.stress}</span>}
                </div>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-accent-300">
                {costOf(a.type)} PB{a.type === 'Minion' ? '/grupo' : ''}
              </span>
              <Button tone="emerald" onClick={() => add(a)}>
                Add
              </Button>
            </li>
          ))}
        </ul>

        {filtered.length > limit && (
          <div className="mt-3 flex justify-center">
            <Button onClick={() => setLimit((n) => n + PAGE)}>Mostrar mais</Button>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-slate-300">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
