import { useState } from 'react';
import { MAX_FEAR, clamp, type Ctx } from './model';
import { Button, Panel, Track } from './ui';

/** The GM's Fear pool. Only rendered in the GM view. */
export function FearPanel({ ctx, fear }: { ctx: Ctx; fear: number }) {
  const [amount, setAmount] = useState(1);

  const write = (value: number) => ctx.set('fear', { kind: 'fear', value: clamp(value, 0, MAX_FEAR) });

  function gain(n: number) {
    const next = clamp(fear + n, 0, MAX_FEAR);
    if (next === fear) return;
    write(next);
    ctx.log('fear', `GM gained ${next - fear} Fear (total ${next})`);
  }

  function spend(n: number) {
    if (n > fear) return;
    write(fear - n);
    ctx.log('fear', `GM spent ${n} Fear (${fear - n} left)`, `GM spent ${n} Fear`);
  }

  return (
    <Panel
      title="Game Master's Fear"
      action={
        <span className="text-2xl font-bold tabular-nums text-accent-300">
          {fear}
          <span className="text-sm font-normal text-slate-500">/{MAX_FEAR}</span>
        </span>
      }
    >
      <Track label="Fear" max={MAX_FEAR} marked={fear} tone="amber" onSet={write} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button aria-label="Remove 1 Fear" onClick={() => write(fear - 1)} disabled={fear === 0}>
          −1
        </Button>
        <Button aria-label="Add 1 Fear" onClick={() => write(fear + 1)} disabled={fear >= MAX_FEAR}>
          +1
        </Button>
        <input
          type="number"
          min={1}
          max={MAX_FEAR}
          value={amount}
          onChange={(event) => setAmount(clamp(Number.parseInt(event.target.value, 10) || 1, 1, MAX_FEAR))}
          aria-label="Amount"
          className="w-14 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs tabular-nums"
        />
        <Button tone="amber" onClick={() => gain(amount)} disabled={fear >= MAX_FEAR}>
          Gain Fear
        </Button>
        <Button tone="rose" onClick={() => spend(amount)} disabled={fear < amount}>
          Spend Fear
        </Button>
      </div>
    </Panel>
  );
}
