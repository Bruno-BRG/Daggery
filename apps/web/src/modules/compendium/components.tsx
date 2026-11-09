import { Icon } from '../../components/Icon';
import { useState, type ReactNode } from 'react';
import { useDiceTray } from '../../dice3d';
import { DICE_EXPRESSION, cardSrc, type Feature } from './data';
import { sendRoll } from '../../sync/rollSocket';

/* ------------------------------------------------------------------ */
/* Small shared UI                                                     */
/* ------------------------------------------------------------------ */

type ChipTone = 'slate' | 'amber' | 'sky' | 'rose' | 'violet' | 'emerald' | 'stone';

const CHIP_TONES: Record<ChipTone, string> = {
  slate: 'border-slate-700 bg-slate-800/80 text-slate-300',
  amber: 'border-accent-700/50 bg-accent-500/10 text-accent-300',
  sky: 'border-sky-700/50 bg-sky-500/10 text-sky-300',
  rose: 'border-rose-700/50 bg-rose-500/10 text-rose-300',
  violet: 'border-violet-700/50 bg-violet-500/10 text-violet-300',
  emerald: 'border-emerald-700/50 bg-emerald-500/10 text-emerald-300',
  stone: 'border-stone-700/60 bg-stone-500/10 text-stone-300',
};

export function Chip({ children, tone = 'slate' }: { children: ReactNode; tone?: ChipTone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium leading-4 ${CHIP_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-100">{value}</div>
      {hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent-400/80">{children}</h3>;
}

/* ------------------------------------------------------------------ */
/* Features                                                           */
/* ------------------------------------------------------------------ */

const FEATURE_KIND_STYLE: Record<string, { tone: ChipTone; label: string }> = {
  Passive: { tone: 'slate', label: 'Passive' },
  Action: { tone: 'sky', label: 'Action' },
  Reaction: { tone: 'amber', label: 'Reaction' },
  Fear: { tone: 'rose', label: 'Fear' },
  Evolution: { tone: 'violet', label: 'Evolution' },
};

export function FeatureBadge({ kind }: { kind: string }) {
  const style = FEATURE_KIND_STYLE[kind];
  return <Chip tone={style?.tone ?? 'stone'}>{style?.label ?? kind}</Chip>;
}

export function FeatureList({ features, title }: { features: Feature[]; title?: string }) {
  if (features.length === 0) return null;
  return (
    <section>
      <SectionTitle>{title ?? 'Features'}</SectionTitle>
      <ul className="flex flex-col gap-2">
        {features.map((feature, index) => (
          <li key={`${feature.name}-${index}`} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
            <details className="compendium-feature">
              <summary className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-100">{feature.name}</span>
                {feature.kind ? <FeatureBadge kind={feature.kind} /> : null}
                <Icon name="chevron" />
              </summary>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{feature.text}</p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Card art                                                           */
/* ------------------------------------------------------------------ */

export interface ZoomRequest {
  src: string;
  alt: string;
}

export function CardImage({
  file,
  alt,
  onZoom,
  thumb = false,
  className = 'aspect-[2/3]',
}: {
  file: string;
  alt: string;
  onZoom?: (request: ZoomRequest) => void;
  thumb?: boolean;
  className?: string;
}) {
  const src = cardSrc(file, thumb);
  return (
    <div className={`group relative overflow-hidden rounded-lg border border-slate-700/80 bg-slate-900 ${className}`}>
      <div className="absolute inset-0 grid place-items-center p-2 text-center text-xs leading-tight text-slate-500">{alt}</div>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="relative z-10 h-full w-full object-contain"
        onError={(event) => {
          const image = event.currentTarget;
          if (thumb && image.dataset.fallback !== 'true') {
            image.dataset.fallback = 'true';
            image.src = cardSrc(file, false);
          } else {
            image.style.opacity = '0';
          }
        }}
      />
      {onZoom ? (
        <button
          type="button"
          onClick={() => onZoom({ src: cardSrc(file, false), alt })}
          className="absolute inset-0 z-20 flex items-end justify-center bg-transparent p-2 outline-none transition-colors hover:bg-black/25 focus-visible:ring-2 focus-visible:ring-accent-400"
          aria-label={`Ampliar ${alt}`}
        >
          <span className="rounded-full bg-slate-950/85 px-2 py-0.5 text-xs text-slate-200 opacity-0 transition-opacity group-hover:opacity-100">
            Ampliar
          </span>
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dice rolling                                                       */
/* ------------------------------------------------------------------ */

/**
 * A tiny "Rolar" button for damage expressions such as `1d12+2`. It goes through the shared
 * dice tray, so the dice animate in the side panel and the roll is attributed to `author`.
 */
export function RollButton({ notation, author }: { notation: string; author: string }) {
  const tray = useDiceTray();
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!DICE_EXPRESSION.test(notation)) return null;

  const roll = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await tray.roll(
        { kind: 'dice', notation: notation.trim() },
        {
          author,
          // Report as soon as the result exists; the tray may still be animating (or paused in
          // a background tab), but the log entry and the inline total should not wait for it.
          onComputed: (payload) => {
            sendRoll({ type: 'roll', author, ...payload });
            if (payload.kind === 'dice') {
              setTotal(payload.result.total);
              setBusy(false);
            }
          },
        },
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <button
        type="button"
        onClick={roll}
        disabled={busy}
        className="rounded border border-accent-600/60 bg-accent-500/10 px-1.5 py-0.5 text-xs font-semibold text-accent-300 transition-colors hover:bg-accent-500/20 disabled:opacity-50"
        title={`Roll ${notation}`}
        aria-label={`Roll ${notation}`}
      >
        {busy ? '…' : 'Roll'}
      </button>
      {total !== null ? (
        <span
          className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-slate-200"
          title="Last result"
        >
          {total}
        </span>
      ) : null}
      {failed ? <span className="text-xs text-rose-400">erro</span> : null}
    </span>
  );
}
