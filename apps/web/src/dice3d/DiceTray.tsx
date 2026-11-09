import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Advantage, ClientRollMessage } from '@daggery/shared';
import { addFear } from '../sync/store';
import { describePayload, normalizeAuthor, type RollSpec } from './rollPlan';
import { attachTray } from './tray';
import { useDiceTray } from './useDiceTray';
import { DiceCustomizer } from './DiceCustomizer';
import './overlay.css';

interface DiceTrayProps {
  /** Name the rolls are sent under. */
  author: string;
  /** Receives each roll as soon as it is computed, ready to send to the server. */
  onRolled?: (message: ClientRollMessage) => void;
}

const DIE_SIZES = [4, 6, 8, 10, 20] as const;

/** Plain words for the cause, then the fix. Shown wherever 3D has failed. */
const FLAT_DETAIL = 'This browser could not start the 3D graphics it needs (WebGL 2), so rolls show as flat dice. Results still appear in the history. To get 3D dice, turn on graphics acceleration in Chrome at chrome://settings/system, then reload this page.';

/** One persistent overlay, independent of whether the dice controls are docked or in a drawer. */
export function DiceOverlay() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [host] = useState(() => document.createElement('div'));
  const [inDialog, setInDialog] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  useEffect(() => {
    // A native modal lives above every body-level z-index. Keep the persistent canvas in
    // the open modal's top layer, including while previewing styles on phones.
    const place = () => {
      const dialogs = document.querySelectorAll('dialog[open]');
      const parent = dialogs.item(dialogs.length - 1) ?? document.body;
      if (host.parentElement !== parent) parent.appendChild(host);
      setInDialog(parent !== document.body);
      setDockOpen(document.querySelector('.daggery-rolls') !== null);
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => {
      observer.disconnect();
      host.remove();
    };
  }, [host]);
  useEffect(() => {
    if (overlayRef.current) return attachTray(overlayRef.current);
  }, [host]);
  return createPortal(
    <>
      <div ref={overlayRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-50" />
      <DiceFallbackNote hidden={inDialog} dockOpen={dockOpen} />
    </>,
    host,
  );
}

/**
 * Note beside the Dice button. It appears only after 3D has failed, and stays hidden while a
 * dialog covers the top bar, where the drawer already shows the same message.
 */
function DiceFallbackNote({ hidden, dockOpen }: { hidden: boolean; dockOpen: boolean }) {
  const { status } = useDiceTray();
  const [dismissed, setDismissed] = useState(false);
  const [anchor, setAnchor] = useState({ top: 64, right: 16 });
  const visible = status === 'flat' && !hidden && !dismissed;
  useEffect(() => {
    if (!visible) return;
    const place = () => {
      const toggle = document.querySelector<HTMLElement>('.daggery-dice-toggle')?.getBoundingClientRect();
      const dock = document.querySelector<HTMLElement>('.daggery-rolls')?.getBoundingClientRect();
      if (!toggle || toggle.width === 0) return;
      // With the docked dice panel open, sit beside it so its controls stay clickable.
      const right = dock && dock.width > 0 ? window.innerWidth - dock.left + 12 : window.innerWidth - toggle.right;
      setAnchor({ top: toggle.bottom + 8, right: Math.max(8, right) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [visible, dockOpen]);
  if (!visible) return null;
  return (
    <div role="status" className="dice-fallback-note" style={{ top: anchor.top, right: anchor.right }}>
      <strong>3D dice are unavailable</strong>
      <p>{FLAT_DETAIL}</p>
      <button type="button" onClick={() => setDismissed(true)}>Dismiss</button>
    </div>
  );
}

/** Duality and damage controls. */
export function DiceTray({ author, onRolled }: DiceTrayProps) {
  const { roll, status } = useDiceTray();
  // Kept as typed, so a lone "-" on the way to a negative modifier isn't snapped back to 0.
  const [modifierInput, setModifierInput] = useState('');
  const modifier = Number.parseInt(modifierInput, 10) || 0;
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [rolling, setRolling] = useState(false);
  const rollingRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function throwDice(spec: RollSpec) {
    if (rollingRef.current) return;
    rollingRef.current = true;
    setRolling(true);
    const name = normalizeAuthor(author);
    setError(null);
    roll(spec, {
      author: name,
      onComputed: (payload) => {
        setSummary(describePayload(payload));
        onRolled?.({ type: 'roll', author: name, ...payload });
        if (payload.kind === 'duality' && payload.result.withFear) addFear(1);
      },
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : 'Roll failed');
    }).finally(() => {
      rollingRef.current = false;
      setRolling(false);
    });
  }

  const suffix = modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : `${modifier}`;
  const duality = (advantage?: Advantage) => throwDice({ kind: 'duality', modifier, advantage });

  return (
    <div className="flex flex-col gap-4">
      <label className="flex w-28 flex-col gap-1.5 text-xs">
        <span className="font-medium text-slate-400">Modifier</span>
        <input
          type="number"
          inputMode="numeric"
          placeholder="0"
          value={modifierInput}
          onChange={(e) => setModifierInput(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm tabular-nums text-slate-100 placeholder:text-slate-500 focus:border-accent-500/60 focus:outline-none"
        />
      </label>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => duality()}
          disabled={rolling}
          className="rounded-lg bg-accent-500 px-3 py-3 text-base font-semibold text-slate-950 shadow-sm transition hover:bg-accent-400 active:bg-accent-600"
        >
          {rolling ? 'Rolling…' : 'Roll Duality'}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            title="Duality with advantage (+ d6)"
            onClick={() => duality('advantage')}
            disabled={rolling}
            className="rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-3 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-900/50"
          >
            Advantage
          </button>
          <button
            type="button"
            title="Duality with disadvantage (- d6)"
            onClick={() => duality('disadvantage')}
            disabled={rolling}
            className="rounded-lg border border-slate-600 bg-slate-800/60 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            Disadvantage
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-slate-400">Dice</span>
        <div className="grid grid-cols-5 gap-1.5">
          {DIE_SIZES.map((sides) => (
            <button
              key={sides}
              type="button"
              onClick={() => throwDice({ kind: 'dice', notation: `1d${sides}${suffix}` })}
              disabled={rolling}
              className="rounded-lg border border-slate-700 bg-slate-900 py-2 text-sm font-semibold tabular-nums text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 active:bg-slate-950"
            >
              d{sides}
            </button>
          ))}
        </div>
      </div>

      {summary && (
        <p
          role="status"
          className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-center text-sm tabular-nums text-slate-100"
        >
          {summary}
        </p>
      )}
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <DiceCustomizer ready={status !== 'detached'} />
      {mounted && status === 'flat' && <p className="text-xs leading-5 text-amber-200">3D dice are unavailable. {FLAT_DETAIL}</p>}
      {mounted && status === 'none' && (
        <p className="text-xs text-slate-500">
          Dice animation is unavailable in this browser. Results still appear in the history.
        </p>
      )}
    </div>
  );
}

