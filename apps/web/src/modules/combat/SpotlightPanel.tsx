import {
  clamp,
  fearValue,
  MAX_FEAR,
  toInt,
  type Ctx,
  type LogDoc,
  type PcView,
  type SpotlightDoc,
} from './model';
import { Button, Panel, Track } from './ui';

/** Who holds the spotlight, with pass controls, optional action tokens and the recent passes. */
export function SpotlightPanel({
  ctx,
  pcs,
  spotlight,
  passes,
}: {
  ctx: Ctx;
  pcs: PcView[];
  spotlight: SpotlightDoc;
  passes: LogDoc[];
}) {
  const { holder, tokenMax, tokens, tokensOn } = spotlight;

  const nameOf = (key: string | null) => {
    if (key === null) return 'Nobody';
    if (key === 'GM') return 'GM';
    return pcs.find((pc) => pc.key === key)?.name ?? 'Removed PC';
  };

  const write = (patch: Partial<SpotlightDoc>) => ctx.set('spotlight', { ...spotlight, ...patch, kind: 'spotlight' });

  function pass(to: string) {
    if (to === holder) return;
    const from = nameOf(holder);
    const target = nameOf(to);
    write({ holder: to });
    ctx.log('spotlight', `Spotlight: ${from} → ${target}`, `Spotlight passed to ${target}`);
  }

  /** A PC rolled with Fear: the GM gains a Fear and takes the spotlight. */
  function pcRolledFear() {
    const from = nameOf(holder);
    ctx.set('fear', { kind: 'fear', value: clamp(fearValue(ctx.docs) + 1, 0, MAX_FEAR) });
    write({ holder: 'GM' });
    ctx.log(
      'fear',
      `${from} rolled with Fear: GM gained 1 Fear and takes the spotlight`,
      `${from} rolled with Fear: the Game Master takes the spotlight`,
    );
  }

  const remaining = (key: string) => clamp(tokens[key] ?? tokenMax, 0, tokenMax);
  const setSpent = (key: string, spent: number) =>
    write({ tokens: { ...tokens, [key]: tokenMax - spent } });

  return (
    <Panel
      title="Spotlight"
      action={
        <span className="text-xs text-slate-400">
          Now: <span className="font-semibold text-accent-300">{nameOf(holder)}</span>
        </span>
      }
    >
      <div className="flex flex-wrap gap-1">
        <Button tone="amber" aria-pressed={holder === 'GM'} onClick={() => pass('GM')}>
          GM
        </Button>
        {pcs.map((pc) => (
          <Button
            key={pc.key}
            tone={holder === pc.key ? 'emerald' : 'slate'}
            aria-pressed={holder === pc.key}
            onClick={() => pass(pc.key)}
          >
            {pc.name}
          </Button>
        ))}
      </div>

      <div className="mt-2">
        <Button tone="rose" onClick={pcRolledFear} disabled={holder === 'GM'}>
          PC rolled with Fear (+1 Fear, GM spotlight)
        </Button>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={tokensOn}
          onChange={(event) => write({ tokensOn: event.target.checked })}
        />
        Action tokens per PC (optional tracker)
      </label>

      {tokensOn && (
        <div className="mt-2 flex flex-col gap-2">
          {pcs.length === 0 && <p className="text-xs text-slate-500">Add PCs to use tokens.</p>}
          {pcs.map((pc) => (
            <div key={pc.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-slate-300">{pc.name}</span>
              <div className="flex items-center gap-2">
                <span className="tabular-nums text-slate-400">{remaining(pc.key)}</span>
                <Track
                  label={`${pc.name}'s tokens used`}
                  max={tokenMax}
                  marked={tokenMax - remaining(pc.key)}
                  tone="sky"
                  onSet={(spent) => setSpent(pc.key, spent)}
                />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <label className="flex items-center gap-2">
              Max
              <input
                type="number"
                min={1}
                max={5}
                value={tokenMax}
                onChange={(event) =>
                  write({ tokenMax: clamp(toInt(event.target.value) ?? 3, 1, 5), tokens: {} })
                }
                className="w-14 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 tabular-nums"
              />
            </label>
            <Button onClick={() => write({ tokens: {} })}>Refill</Button>
          </div>
        </div>
      )}

      {passes.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-slate-800 pt-2 text-xs text-slate-400">
          {passes.map((entry) => (
            <li key={`${entry.at}-${entry.text}`} className="truncate">
              <span className="tabular-nums text-slate-500">{new Date(entry.at).toLocaleTimeString()}</span>{' '}
              {ctx.isGM ? entry.text : entry.playerText}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
