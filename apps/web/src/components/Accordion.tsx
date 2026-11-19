import { useEffect, useId, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import './accordion.css';

/**
 * The Daggery layout kit, after Stargazer: every page is built from the same few pieces.
 *
 * - `PanelSection`: a big uppercase heading that folds a whole part of a page (ORACLES, MOVES).
 * - `Group`: a boxed category that folds open (Core, Combat, Places & loot).
 * - `Row`: one line inside a group: an optional leading button, a label with its value
 *   under it, and an action on the right (roll, open, delete).
 * - `ItemCard`: a card tinted by its kind, with a title and a caption, that opens in place.
 * - `SearchField`: the search box at the top of a list.
 * - `IconButton`: a square icon button; `tone="action"` is the highlighted one (roll, add).
 *
 * Folding state is uncontrolled by default; pass `storageKey` to remember it across visits,
 * or `open` + `onToggle` to control it.
 */

function useFold(defaultOpen: boolean, storageKey?: string, open?: boolean, onToggle?: (open: boolean) => void): [boolean, () => void] {
  const [own, setOwn] = useState(() => {
    if (!storageKey) return defaultOpen;
    try { const saved = localStorage.getItem(`daggery.fold.${storageKey}`); return saved === null ? defaultOpen : saved === '1'; } catch { return defaultOpen; }
  });
  useEffect(() => {
    if (storageKey && open === undefined) try { localStorage.setItem(`daggery.fold.${storageKey}`, own ? '1' : '0'); } catch { /* storage blocked */ }
  }, [own, storageKey, open]);
  const current = open ?? own;
  return [current, () => { if (onToggle) onToggle(!current); if (open === undefined) setOwn(!current); }];
}

export function PanelSection({ id, title, actions, defaultOpen = true, storageKey, open, onToggle, children, className }: {
  id?: string; title: ReactNode; actions?: ReactNode; defaultOpen?: boolean; storageKey?: string;
  open?: boolean; onToggle?: (open: boolean) => void; children: ReactNode; className?: string;
}) {
  const [isOpen, toggle] = useFold(defaultOpen, storageKey, open, onToggle);
  const body = useId();
  return <section id={id} className={`sg-section${isOpen ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
    <h2 className="sg-section-head">
      <button type="button" aria-expanded={isOpen} aria-controls={body} onClick={toggle}>
        <span>{title}</span><Icon name="chevron" />
      </button>
      {actions && <span className="sg-section-actions">{actions}</span>}
    </h2>
    {isOpen && <div className="sg-section-body" id={body}>{children}</div>}
  </section>;
}

export function Group({ id, title, icon, count, defaultOpen = false, storageKey, open, onToggle, onClear, clearLabel, children }: {
  id?: string; title: ReactNode; icon?: IconName; count?: number; defaultOpen?: boolean; storageKey?: string;
  open?: boolean; onToggle?: (open: boolean) => void;
  /** Shows the × at the foot of the open group; disabled when undefined is passed as `null`. */
  onClear?: (() => void) | null; clearLabel?: string; children: ReactNode;
}) {
  const [isOpen, toggle] = useFold(defaultOpen, storageKey, open, onToggle);
  return <section id={id} className={`sg-group${isOpen ? ' is-open' : ''}`}>
    <h3 className="sg-group-head">
      <button type="button" aria-expanded={isOpen} onClick={toggle}>
        {icon && <Icon name={icon} />}<span>{title}</span>{count !== undefined && <small>{count}</small>}<Icon name="chevron" />
      </button>
    </h3>
    {isOpen && <div className="sg-group-body">
      {children}
      {onClear !== undefined && <button type="button" className="sg-group-clear" disabled={!onClear} onClick={onClear ?? undefined} aria-label={clearLabel ?? 'Clear'} title={clearLabel ?? 'Clear'}><Icon name="close" /></button>}
    </div>}
  </section>;
}

export function Row({ id, label, value, leading, action, children, current }: {
  id?: string; label: ReactNode; value?: ReactNode; leading?: ReactNode; action?: ReactNode; children?: ReactNode; current?: boolean;
}) {
  return <div id={id} className={`sg-row${value ? ' has-value' : ''}${current ? ' is-current' : ''}`}>
    <div className="sg-row-line">
      {leading}
      <div className="sg-row-text" aria-live="polite">
        <span className="sg-row-label">{label}</span>
        {value && <strong className="sg-row-value">{value}</strong>}
      </div>
      {action}
    </div>
    {children}
  </div>;
}

export function ItemCard({ id, title, caption, icon, tone, defaultOpen = false, open, onToggle, children, actions }: {
  id?: string; title: ReactNode; caption?: ReactNode; icon?: IconName;
  /** Any CSS colour; tints the card's edge and header. Defaults to the brand colour. */
  tone?: string; defaultOpen?: boolean; open?: boolean; onToggle?: (open: boolean) => void;
  /** Buttons shown on the header's right, before the chevron. */
  actions?: ReactNode; children?: ReactNode;
}) {
  const [isOpen, toggle] = useFold(defaultOpen, undefined, open, onToggle);
  return <div id={id} className={`sg-card${isOpen ? ' is-open' : ''}`} style={tone ? { ['--sg-tone' as string]: tone } : undefined}>
    <div className="sg-card-head">
      <button type="button" className="sg-card-summary" aria-expanded={children ? isOpen : undefined} onClick={children ? toggle : undefined} disabled={!children}>
        <span className="sg-card-text">
          <strong>{title}</strong>
          {caption && <small>{icon && <Icon name={icon} />}{caption}</small>}
        </span>
        {children && <Icon name="chevron" />}
      </button>
      {actions && <span className="sg-card-actions">{actions}</span>}
    </div>
    {isOpen && children && <div className="sg-card-body">{children}</div>}
  </div>;
}

export function SearchField({ value, onChange, placeholder = 'Search name or key word', label, inputRef }: {
  value: string; onChange: (value: string) => void; placeholder?: string; label?: string; inputRef?: React.Ref<HTMLInputElement>;
}) {
  return <label className="sg-search">
    <Icon name="search" />
    <input ref={inputRef} type="search" value={value} placeholder={placeholder} aria-label={label ?? placeholder} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') onChange(''); }} />
  </label>;
}

export function IconButton({ icon, label, onClick, tone = 'plain', pressed, disabled, type = 'button' }: {
  icon: IconName; label: string; onClick?: () => void; tone?: 'plain' | 'action' | 'danger'; pressed?: boolean; disabled?: boolean; type?: 'button' | 'submit';
}) {
  return <button type={type} className={`sg-icon-button is-${tone}`} aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}><Icon name={icon} /></button>;
}

/** Tones for `ItemCard`, so kinds keep the same colour on every page. */
export const TONES = {
  teal: '#3aa0a8', gold: '#c9a24a', blue: '#6c8fd6', green: '#5daa6e',
  pink: '#c46fa6', violet: '#9a7fd8', red: '#d0684f', orange: '#d98a45', fear: 'var(--ds-fear)', brand: 'var(--ds-brand)',
} as const;
