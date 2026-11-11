import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type Tone = 'slate' | 'amber' | 'rose' | 'emerald' | 'sky' | 'violet';

const TONE: Record<Tone, string> = {
  slate: 'border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700',
  amber: 'border-accent-700 bg-accent-500/15 text-accent-200 hover:bg-accent-500/25',
  rose: 'border-rose-800 bg-rose-900/40 text-rose-200 hover:bg-rose-900/70',
  emerald: 'border-emerald-700 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-800/60',
  sky: 'border-sky-800 bg-sky-900/40 text-sky-200 hover:bg-sky-800/60',
  violet: 'border-violet-800 bg-violet-900/40 text-violet-200 hover:bg-violet-800/60',
};

export function Button({
  tone = 'slate',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      type="button"
      {...rest}
      className={`folio-combat-button rounded-md border px-2 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${TONE[tone]} ${className}`}
    />
  );
}

export function Badge({ tone = 'slate', title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className={`folio-combat-badge inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-semibold ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="folio-panel">
      <div className="folio-panel-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const SLOT_TONE = {
  rose: 'border-rose-400 bg-rose-500',
  sky: 'border-sky-400 bg-sky-500',
  amber: 'border-accent-300 bg-accent-500',
} as const;

/**
 * Clickable slot track. The first `marked` slots are filled. Clicking a filled slot unmarks it and
 * everything after it; clicking an empty slot marks everything up to it.
 */
export function Track({
  label,
  max,
  marked,
  onSet,
  tone = 'rose',
}: {
  label: string;
  max: number;
  marked: number;
  onSet?: (next: number) => void;
  tone?: keyof typeof SLOT_TONE;
}) {
  const count = Math.max(0, Math.floor(max));
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {Array.from({ length: count }, (_, i) => {
        const filled = i < marked;
        const base = `h-4 w-4 rounded-sm border transition ${filled ? SLOT_TONE[tone] : 'border-slate-600 bg-slate-950'}`;
        if (!onSet) return <span key={i} className={base} />;
        return (
          <button
            key={i}
            type="button"
            aria-label={`${label} ${i + 1}`}
            aria-pressed={filled}
            onClick={() => onSet(filled ? i : i + 1)}
            className={`${base} hover:border-slate-300`}
          />
        );
      })}
    </div>
  );
}

/** Damage input that previews what the damage does before it is applied. */
export function DamageInput({
  describe,
  onApply,
}: {
  describe: (damage: number) => string;
  onApply: (damage: number) => void;
}) {
  const [text, setText] = useState('');
  const damage = Number.parseInt(text, 10);
  const valid = Number.isFinite(damage) && damage > 0;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onApply(damage);
        setText('');
      }}
    >
      <input
        type="number"
        min={1}
        inputMode="numeric"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Damage"
        aria-label="Damage taken"
        className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs tabular-nums"
      />
      <span className="min-w-0 flex-1 text-xs text-slate-400">
        {valid ? describe(damage) : 'Enter the damage dealt'}
      </span>
      <Button type="submit" tone="rose" disabled={!valid}>
        Apply
      </Button>
    </form>
  );
}
