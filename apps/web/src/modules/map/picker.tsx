import { useMemo, useState } from 'react';
import { adversaries } from '@daggery/content';
import { useDocs } from '../../sync/store';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { TOKEN_COLORS, type MapToken } from './model';
import { sheetEntry, type SheetEntry } from './sheetToken';
import { TokenPortrait } from './TablePanels';
export type AdversaryEntry = (typeof adversaries)[number];
export type { SheetEntry } from './sheetToken';

export function CompendiumPicker({ onClose, onAdversary, onSheet, onMarker }: {
  onClose: () => void; onAdversary: (adv: AdversaryEntry) => void; onSheet: (sheet: SheetEntry) => void;
  onMarker: (marker: Pick<MapToken, 'name' | 'color' | 'size'>) => void;
}) {
  const [tab, setTab] = useState<'sheet' | 'adversary' | 'marker'>('sheet');
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState('');
  const [added, setAdded] = useState('');
  const [markerName, setMarkerName] = useState('');
  const [color, setColor] = useState(TOKEN_COLORS[0]!);
  const [size, setSize] = useState(1);
  const { items } = useDocs<Record<string, unknown>>('sheets');
  const q = query.trim().toLowerCase();
  const party = useMemo(() => Object.entries(items).map(([id, value]) => sheetEntry(id, value)).filter((item): item is SheetEntry => item !== null).filter(item => item.name.toLowerCase().includes(q)), [items, q]);
  const opponents = useMemo(() => adversaries.filter(item => item.name.toLowerCase().includes(q) && (!tier || Number(item.tier) === Number(tier))), [q, tier]);
  return <Dialog open onClose={onClose} title="Add miniatures" className="vtt-picker-dialog room-dialog"><p className="vtt-picker-intro">Every story needs its heroes. And a little trouble.</p>
    <div className="vtt-picker-tabs" role="group" aria-label="Miniature source">{([['sheet', 'Your party', 'users'], ['adversary', 'Adversaries', 'combat'], ['marker', 'Custom marker', 'compass']] as const).map(([id, label, icon]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => { setTab(id); setQuery(''); }}><Icon name={icon} />{label}</button>)}</div>
    {tab !== 'marker' && <div className="vtt-picker-search-row"><label className="vtt-search"><Icon name="search" /><input data-autofocus aria-label="Search miniatures" placeholder={tab === 'sheet' ? 'Find a party member…' : 'Find an adversary…'} value={query} onChange={event => setQuery(event.target.value)} /></label>{tab === 'adversary' && <select aria-label="Adversary tier" value={tier} onChange={event => setTier(event.target.value)}><option value="">All tiers</option>{[1, 2, 3, 4].map(value => <option key={value} value={value}>Tier {value}</option>)}</select>}</div>}
    {added && <p role="status" className="vtt-added"><Icon name="check" />{added} added to the scene.</p>}
    {tab === 'sheet' && <><p className="vtt-picker-hint">Hit Points and Stress stay linked to the character sheet.</p><ul className="vtt-picker-list">{party.map(item => <li key={item.id}><button type="button" onClick={() => { onSheet(item); setAdded(item.name); }} aria-label={`Add ${item.name}`}><TokenPortrait token={{ name: item.name, color: '#a47e59', image: item.image }} /><span><strong>{item.name}</strong><small>{item.className ?? 'Character'} · {item.hp?.current ?? '—'}/{item.hp?.max ?? '—'} HP</small></span><Icon name="plus" /></button></li>)}</ul>{party.length === 0 && <div className="vtt-panel-empty"><Icon name="users" /><h3>{q ? 'No matching heroes.' : 'Your party is still gathering.'}</h3><p>Create a character in Characters, then add them here.</p></div>}</>}
    {tab === 'adversary' && <ul className="vtt-picker-list">{opponents.slice(0, 120).map(item => <li key={item.id}><button type="button" aria-label={`Add ${item.name}`} onClick={() => { onAdversary(item); setAdded(item.name); }}><TokenPortrait token={{ name: item.name, color: '#a34b60' }} /><span><strong>{item.name}</strong><small>Tier {item.tier} · {item.type} · {item.hp} HP · Difficulty {item.difficulty}</small></span><Icon name="plus" /></button></li>)}{opponents.length === 0 && <li className="vtt-panel-note">No adversaries match. Try another name or tier.</li>}</ul>}
    {tab === 'marker' && <form className="vtt-marker-form" onSubmit={event => { event.preventDefault(); const name = markerName.trim() || 'Marker'; onMarker({ name, color, size }); setAdded(name); }}><div className="vtt-marker-preview"><TokenPortrait token={{ name: markerName || 'Marker', color }} /></div><label className="vtt-form-field">Marker name<input value={markerName} onChange={event => setMarkerName(event.target.value)} maxLength={80} placeholder="e.g. The hidden entrance" /></label><fieldset className="vtt-marker-colors"><legend>Miniature color</legend>{TOKEN_COLORS.map(value => <button key={value} type="button" style={{ background: value }} aria-label={`Color ${value}`} aria-pressed={color === value} onClick={() => setColor(value)}>{color === value && <Icon name="check" />}</button>)}</fieldset><label className="vtt-form-field">Base size<select value={size} onChange={event => setSize(Number(event.target.value))}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value} × {value} cells</option>)}</select></label><button type="submit" className="daggery-primary"><Icon name="plus" />Add marker</button></form>}
    <div className="vtt-picker-footer"><span>Add as many as your scene needs.</span><button type="button" className="daggery-roll-toggle" onClick={onClose}>Done</button></div>
  </Dialog>;
}
