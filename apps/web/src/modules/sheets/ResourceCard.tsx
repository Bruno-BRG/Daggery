import { Icon, type IconName } from '../../components/Icon';

export function ResourceCard({ label, icon, count, max, tone, positive = false, onChange }: {
  label: string; icon: IconName; count: number; max: number; tone: string;
  positive?: boolean; onChange: (count: number) => void;
}) {
  const value = Math.max(0, Math.min(max, positive ? count : max - count));
  const gain = () => onChange(Math.max(0, Math.min(max, count + (positive ? 1 : -1))));
  const spend = () => onChange(Math.max(0, Math.min(max, count + (positive ? -1 : 1))));
  return <section className={`folio-resource resource-${tone}`} aria-label={label}>
    <div className="folio-resource-label"><Icon name={icon} /><h2>{label}</h2></div>
    <div className="folio-resource-value"><strong>{value}</strong><span>/ {max}</span><div className="folio-resource-stepper"><button type="button" onClick={spend} disabled={value <= 0} aria-label={`Decrease ${label}`}><Icon name="minus" /></button><button type="button" onClick={gain} disabled={value >= max} aria-label={`Increase ${label}`}><Icon name="plus" /></button></div></div>
    <div className="folio-resource-pips" role="group" aria-label={`${label} slots`}>{Array.from({ length: max }, (_, i) => <button key={i} type="button" aria-label={`${label} slot ${i + 1}`} aria-pressed={i < value} title={`Set remaining ${label}`} className={i < value ? 'is-filled' : ''} onClick={() => { const remaining = i < value ? i : i + 1; onChange(positive ? remaining : max - remaining); }} />)}</div>
  </section>;
}
