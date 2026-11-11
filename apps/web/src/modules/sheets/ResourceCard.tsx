import { memo } from 'react';
import { Icon, type IconName } from '../../components/Icon';

const MAX_PIPS = 24;

/**
 * `positive` resources (Stress marked, Hope held) show `count` directly: 0 / max on a fresh sheet.
 * Other resources (HP, Armor) store marked slots but display what remains: full on a fresh sheet.
 * `max` is only the number of slots shown, so features that raise it are never clamped.
 */
function ResourceCardBase({ label, icon, count, max, tone, positive = false, onChange }: {
  label: string; icon: IconName; count: number; max: number; tone: string;
  positive?: boolean; onChange: (count: number) => void;
}) {
  const value = positive ? Math.max(0, count) : Math.max(0, max - count);
  const pips = Math.min(MAX_PIPS, Math.max(max, value));
  const setValue = (next: number) => {
    const clamped = Math.max(0, positive ? next : Math.min(max, next));
    onChange(positive ? clamped : max - clamped);
  };
  return <section className={`folio-resource resource-${tone}`} aria-label={label}>
    <div className="folio-resource-label"><Icon name={icon} /><h2>{label}</h2></div>
    <div className="folio-resource-value"><strong>{value}</strong><span>/ {max}</span><div className="folio-resource-stepper"><button type="button" onClick={() => setValue(value - 1)} disabled={value <= 0} aria-label={`Decrease ${label}`}><Icon name="minus" /></button><button type="button" onClick={() => setValue(value + 1)} disabled={!positive && value >= max} aria-label={`Increase ${label}`}><Icon name="plus" /></button></div></div>
    <div className="folio-resource-pips" role="group" aria-label={`${label} slots`}>{Array.from({ length: pips }, (_, i) => <button key={i} type="button" aria-label={`${label} slot ${i + 1}`} aria-pressed={i < value} className={i < value ? 'is-filled' : ''} onClick={() => setValue(i < value ? i : i + 1)} />)}</div>
  </section>;
}

export const ResourceCard = memo(ResourceCardBase);
