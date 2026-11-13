import { memo, useId } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { changeResourceCount, resourceTrack } from './resource-track';

type ResourceCardProps = {
  label: string;
  icon: IconName;
  /** Marked slots for HP, Stress and Armor; available points for Hope. */
  count: number;
  max: number;
  tone: string;
  kind?: 'marked' | 'held';
  onChange: (count: number) => void;
  extraSlots?: { value: number; onChange: (raw: string) => void };
  /** One-line row for the play dashboard. */
  compact?: boolean;
};

function ResourceCardBase({ label, icon, count, max, tone, kind = 'marked', onChange, extraSlots, compact = false }: ResourceCardProps) {
  const helpId = useId();
  const { value, slots, canIncrease } = resourceTrack(count, max);
  const setValue = (next: number) => onChange(changeResourceCount(count, next, max));
  return <section className={`folio-resource resource-${tone}${compact ? ' is-compact' : ''}`} aria-label={label}>
    <header className="folio-resource-header">
      <div className="folio-resource-label"><Icon name={icon} /><h2>{label}</h2></div>
      <span className="folio-resource-counter" aria-live="polite" aria-atomic="true"><strong>{value}<span> / {max}</span></strong>{' '}<small>{kind === 'held' ? 'available' : 'marked'}</small></span>
    </header>
    <div className="folio-resource-track">
      <button className="folio-resource-control" type="button" onClick={() => setValue(value - 1)} disabled={value <= 0} aria-label={`Decrease ${label}`}><Icon name="minus" /></button>
      <div className="folio-resource-pips" role="group" aria-label={`${label} slots`}>
        {Array.from({ length: slots }, (_, i) => <button key={i} type="button" aria-label={`${label} slot ${i + 1}`} aria-pressed={i < value} className={i < value ? 'is-filled' : ''} onClick={() => setValue(i < value ? i : i + 1)}><span aria-hidden="true" /></button>)}
        {slots === 0 && <span className="folio-resource-empty">No slots</span>}
      </div>
      <button className="folio-resource-control" type="button" onClick={() => setValue(value + 1)} disabled={!canIncrease} aria-label={`Increase ${label}`}><Icon name="plus" /></button>
    </div>
    {max > slots && <p className="folio-resource-overflow">Showing {slots} of {max} slots. Use − / + for the full track.</p>}
    {extraSlots && <details className="folio-resource-adjustment">
      <summary aria-label={compact ? `Adjust maximum ${label}` : undefined} title={compact ? `Adjust maximum ${label}` : undefined}><Icon name="settings" /><span>Adjust maximum</span>{extraSlots.value > 0 && <small>+{extraSlots.value}</small>}<Icon name="chevron" /></summary>
      <div>
        <label>Extra slots<input type="number" min={0} step={1} inputMode="numeric" aria-label={`Extra ${label} slots`} aria-describedby={helpId} value={extraSlots.value} onChange={event => extraSlots.onChange(event.target.value)} /></label>
        <p id={helpId}>From items or effects. Adds to ancestry and level-up slots without changing your marks.</p>
      </div>
    </details>}
  </section>;
}

export const ResourceCard = memo(ResourceCardBase);
