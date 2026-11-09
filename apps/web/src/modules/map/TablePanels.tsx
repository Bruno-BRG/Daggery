import { useState, type CSSProperties } from 'react';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { BOARD_STYLES, initials, type MapScene, type MapToken } from './model';
import { SCENE_TEMPLATES, sceneFromTemplate } from './scenes';

export function TokenPortrait({ token }: { token: Pick<MapToken, 'name' | 'color' | 'image'> }) {
  const [failed, setFailed] = useState('');
  return <span className="vtt-token-portrait" style={{ '--token-color': token.color } as CSSProperties}>{token.image && token.image !== failed ? <img src={token.image} alt="" onError={() => setFailed(token.image ?? '')} /> : <span>{initials(token.name)}</span>}</span>;
}

export function SceneManager({ scenes, sceneId, activeId, onView, onActivate, onCreate, onRename, onDuplicate, onDelete }: {
  scenes: MapScene[]; sceneId: string; activeId: string | null;
  onView: (id: string) => void; onActivate: (id: string) => void; onCreate: () => void;
  onRename: (id: string, name: string) => void; onDuplicate: (id: string) => void; onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const visible = scenes.filter(scene => scene.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="vtt-scene-manager">
    <div className="vtt-panel-heading"><div><span>YOUR WORLDS</span><h2>Scenes <small>{scenes.length}</small></h2></div><button type="button" className="vtt-square" onClick={onCreate} aria-label="New scene"><Icon name="plus" /></button></div>
    {scenes.length > 2 && <label className="vtt-search"><Icon name="search" /><input aria-label="Find a scene" placeholder="Find a scene…" value={query} onChange={event => setQuery(event.target.value)} /></label>}
    <div className="vtt-scene-cards">{visible.map(scene => <article key={scene.id} className={`vtt-scene-card ${scene.id === sceneId ? 'is-viewed' : ''}`}>
      <button type="button" className="vtt-scene-image" aria-label={`Preview ${scene.name}`} aria-current={scene.id === sceneId ? 'true' : undefined} onClick={() => onView(scene.id)} style={{ backgroundColor: BOARD_STYLES[scene.boardStyle ?? 'midnight'].surface }}>{scene.mapUrl ? <img src={scene.mapUrl} alt="" /> : <span className="vtt-scene-grid"><Icon name="map" /></span>}<span className="vtt-scene-dimensions">{scene.cols} × {scene.rows}</span>{activeId === scene.id && <span className="vtt-live-badge"><i />ACTIVE</span>}{scene.id === sceneId && <span className="vtt-preview-label"><Icon name="eye" />Viewing</span>}</button>
      <div className="vtt-scene-card-body">{editing === scene.id ? <form className="vtt-rename" onSubmit={event => { event.preventDefault(); if (name.trim()) { onRename(scene.id, name.trim()); setEditing(null); } }}><input autoFocus aria-label="Scene name" maxLength={100} value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setEditing(null); }} /><button type="submit" aria-label="Save scene name"><Icon name="check" /></button></form> : <strong>{scene.name}</strong>}
        <div className="vtt-scene-card-footer"><span>{scene.mapUrl ? 'Battle map' : `${BOARD_STYLES[scene.boardStyle ?? 'midnight'].label} canvas`}</span>{activeId !== scene.id && <button type="button" className="vtt-scene-activate" onClick={() => onActivate(scene.id)} title="Make this the active scene">Set active<Icon name="arrow" /></button>}<details className="vtt-scene-menu"><summary aria-label={`Manage ${scene.name}`}><Icon name="more" /></summary><div><button type="button" onClick={event => { setEditing(scene.id); setName(scene.name); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Rename</button><button type="button" onClick={event => { onDuplicate(scene.id); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Duplicate scene</button><button type="button" className="is-danger" onClick={() => { if (window.confirm(`Delete ${scene.name}, including its miniatures, drawings, fog, and encounter?`)) onDelete(scene.id); }}>Delete scene</button></div></details></div>
      </div>
    </article>)}</div>
    {scenes.length === 0 && <div className="vtt-panel-empty"><Icon name="map" /><h3>Every world starts somewhere.</h3><p>Create a scene from a battle map or an open canvas.</p></div>}
    {scenes.length > 0 && visible.length === 0 && <p className="vtt-panel-note">No scenes match your search.</p>}
    <button type="button" className="vtt-new-scene" onClick={onCreate}><Icon name="plus" />Create a scene</button>
    <p className="vtt-panel-note">Preview a scene while you prepare. Set it active when you’re ready.</p>
  </div>;
}

export function MiniatureRoster({ tokens, selectedId, onSelect, onAdd }: { tokens: MapToken[]; selectedId: string | null; onSelect: (id: string) => void; onAdd?: () => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const visible = tokens.filter(token => token.name.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || token.kind === filter));
  return <div><div className="vtt-panel-heading"><div><span>ON THIS SCENE</span><h2>Miniatures <small>{tokens.length}</small></h2></div>{onAdd && <button type="button" className="vtt-square" onClick={onAdd} aria-label="Add miniatures"><Icon name="plus" /></button>}</div>
    <label className="vtt-search"><Icon name="search" /><input aria-label="Find a miniature" placeholder="Find a miniature…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="vtt-roster-filters" role="group" aria-label="Miniature types">{[['all', 'All'], ['character', 'Party'], ['adversary', 'Adversaries'], ['marker', 'Markers']].map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id!)}>{label}</button>)}</div>
    <ul className="vtt-roster">{visible.map(token => <li key={token.id}><button type="button" aria-label={`Select ${token.name}`} aria-current={selectedId === token.id ? 'true' : undefined} onClick={() => onSelect(token.id)}><TokenPortrait token={token} /><span className="vtt-roster-info"><strong>{token.name}</strong><small>{token.kind === 'character' ? 'Party member' : token.kind === 'adversary' ? 'Adversary' : 'Marker'}{token.hidden ? ' · Hidden' : ''}{token.locked ? ' · Locked' : ''}</small>{token.hp && <span className="vtt-roster-hp"><i style={{ width: `${Math.max(0, Math.min(100, 100 * token.hp.current / Math.max(1, token.hp.max)))}%` }} /></span>}</span>{token.hp && <span className="vtt-roster-pool">{token.hp.current}<small>/{token.hp.max}</small></span>}<Icon name="chevron" /></button></li>)}</ul>
    {visible.length === 0 && <div className="vtt-panel-empty"><Icon name="users" /><h3>{tokens.length ? 'No matches here.' : 'Bring your world to life.'}</h3><p>{tokens.length ? 'Try another name or miniature type.' : 'Add your party, adversaries, or a marker to the scene.'}</p></div>}
  </div>;
}

export function SceneCreator({ onClose, onCreate }: { onClose: () => void; onCreate: (scene: MapScene) => void }) {
  const [template, setTemplate] = useState('rocky-forest');
  const [name, setName] = useState('');
  const [cols, setCols] = useState(30);
  const [rows, setRows] = useState(20);
  return <Dialog open onClose={onClose} title="Create a scene" className="vtt-create-dialog room-dialog"><p className="vtt-create-intro">A new place. A new possibility.<br /><span>Choose a starting point, then make it your own.</span></p><form onSubmit={event => { event.preventDefault(); onCreate(sceneFromTemplate(template, name, cols, rows)); }}>
    <div className="vtt-template-grid">{SCENE_TEMPLATES.map(item => <button key={item.id} type="button" className={`vtt-template ${item.id === template ? 'is-selected' : ''}`} aria-pressed={item.id === template} onClick={() => setTemplate(item.id)}><span className={`vtt-template-art template-${item.id}`}>{item.image ? <img src={item.image} alt="" /> : <Icon name={item.id === 'parchment' ? 'note' : 'moon'} />}{item.id === template && <span><Icon name="check" /></span>}</span><strong>{item.name}</strong><small>{item.description}</small></button>)}</div>
    <label className="vtt-form-field">Scene name<input data-autofocus aria-label="New scene name" maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder={SCENE_TEMPLATES.find(item => item.id === template)?.name} /></label>
    {!SCENE_TEMPLATES.find(item => item.id === template)?.image && <div className="vtt-grid-fields"><label className="vtt-form-field">Columns<input type="number" min={4} max={100} value={cols} onChange={event => setCols(Number(event.target.value))} required /></label><span>×</span><label className="vtt-form-field">Rows<input type="number" min={4} max={100} value={rows} onChange={event => setRows(Number(event.target.value))} required /></label></div>}
    <div className="vtt-create-footer"><span>You can upload your own map in scene settings.</span><button type="submit" className="daggery-primary"><Icon name="plus" />Create scene</button></div>
  </form></Dialog>;
}
