import { useState } from 'react';
import { clamp, dieFor, newId, type CountdownDoc, type Ctx } from './model';
import { Button, Panel } from './ui';

const PRESETS = [2, 3, 4, 6, 8, 10, 12, 20];

/**
 * Countdown dice. The GM sees and ticks every countdown; players only see the ones shown to them.
 * A countdown that reaches 0 fires once: the event goes to the log.
 */
export function CountdownPanel({
  ctx,
  countdowns,
}: {
  ctx: Ctx;
  countdowns: [string, CountdownDoc][];
}) {
  const [name, setName] = useState('Countdown');
  const visible = ctx.isGM ? countdowns : countdowns.filter(([, cd]) => cd.visible);

  function add(start: number) {
    ctx.set(`cd:${newId()}`, {
      kind: 'countdown',
      name: name.trim() || 'Countdown',
      start,
      sides: dieFor(start),
      value: start,
      visible: true,
      addedAt: Date.now(),
    });
  }

  function update(id: string, cd: CountdownDoc, patch: Partial<CountdownDoc>) {
    ctx.set(id, { ...cd, ...patch, kind: 'countdown' });
  }

  function tick(id: string, cd: CountdownDoc, delta: number) {
    const value = clamp(cd.value + delta, 0, cd.start);
    if (value === cd.value) return;
    update(id, cd, { value });
    if (value === 0) ctx.log('countdown', `Countdown "${cd.name}" reached 0`, `${cd.name} triggered!`);
  }

  function remove(id: string, cd: CountdownDoc) {
    if (window.confirm(`Remove the countdown "${cd.name}"?`)) ctx.remove(id);
  }

  return (
    <Panel title="Countdowns">
      {ctx.isGM && (
        <div className="mb-3 flex flex-col gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Countdown name"
            placeholder="Name (e.g. Reinforcements arrive)"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
          />
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((start) => (
              <Button key={start} onClick={() => add(start)} title={`Countdown ${start} (d${dieFor(start)})`}>
                {start}
              </Button>
            ))}
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-xs text-slate-500">No active countdowns.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map(([id, cd]) => (
            <li key={id} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-2">
              <div
                className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border-2 bg-slate-950 ${
                  cd.value === 0 ? 'border-rose-500 text-rose-300' : 'border-accent-500/70 text-accent-200'
                }`}
                aria-label={`${cd.name}: ${cd.value} of ${cd.start}`}
              >
                <span className="text-xl font-bold tabular-nums leading-none">{cd.value}</span>
                <span className="mt-0.5 text-xs text-slate-500">d{cd.sides}</span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{cd.name}</div>
                <div className="text-xs text-slate-500">
                  {cd.value === 0 ? 'Triggered' : `Initial ${cd.start}`}
                  {ctx.isGM && !cd.visible && ' · hidden from players'}
                </div>
                {ctx.isGM && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Button aria-label={`Decrease ${cd.name}`} onClick={() => tick(id, cd, -1)} disabled={cd.value === 0}>
                      −
                    </Button>
                    <Button aria-label={`Increase ${cd.name}`} onClick={() => tick(id, cd, 1)} disabled={cd.value >= cd.start}>
                      +
                    </Button>
                    <Button onClick={() => update(id, cd, { value: cd.start })} title="Reset">
                      Reset
                    </Button>
                    <label className="ml-1 flex items-center gap-1 text-xs text-slate-400">
                      <input
                        type="checkbox"
                        checked={cd.visible}
                        onChange={(event) => update(id, cd, { visible: event.target.checked })}
                      />
                      Players see it
                    </label>
                    <Button tone="rose" onClick={() => remove(id, cd)} aria-label={`Remove ${cd.name}`}>
                      ×
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
