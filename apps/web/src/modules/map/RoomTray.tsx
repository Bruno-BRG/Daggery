import { useEffect, useState } from 'react';
import { api } from '../../api';
import { getActiveCampaign } from '../../campaign-context';
import { uploadAsset } from '../../sync/store';
import { RoomIcon, type RoomIconName } from './RoomIcon';
import type { RoomAsset } from './RoomPanels';
import type { MapScene, MapToken, Tool } from './model';
import type { SheetEntry } from './sheetToken';

export type TokenAsset = Partial<MapToken> & Pick<MapToken, 'name' | 'kind' | 'color'>;
export type TrayTab = 'maps' | 'miniatures' | 'animals' | 'props' | 'effects' | 'statuses' | 'notes';
const categories: { id: TrayTab; label: string; icon: RoomIconName }[] = [
  { id: 'maps', label: 'Maps & scenes', icon: 'maps' },
  { id: 'miniatures', label: 'Miniatures', icon: 'players' },
  { id: 'animals', label: 'Animals & mounts', icon: 'animals' },
  { id: 'props', label: 'Props', icon: 'props' },
  { id: 'effects', label: 'Area effects', icon: 'effects' },
  { id: 'statuses', label: 'Attached statuses', icon: 'statuses' },
  { id: 'notes', label: 'Text & notes', icon: 'notes' },
];
const animals: TokenAsset[] = [
  { name: 'Gray wolf', kind: 'marker', assetType: 'animal', image: '/tokens/wolf.png', color: '#bbc5b6', size: 1 },
  { name: 'Saddled horse', kind: 'marker', assetType: 'animal', image: '/tokens/horse.png', color: '#ba946a', size: 2 },
];
const effects: TokenAsset[] = [
  { name: 'Aura', kind: 'marker', assetType: 'effect', color: '#f8d74e', size: 6, effect: { shape: 'circle', opacity: 0.035 } },
  {
    name: 'Flame cone',
    kind: 'marker',
    assetType: 'effect',
    color: '#fb9560',
    size: 8,
    effect: { shape: 'cone', opacity: 0.17 },
  },
  {
    name: 'Arcane ward',
    kind: 'marker',
    assetType: 'effect',
    color: '#b391f7',
    size: 4,
    effect: { shape: 'circle', opacity: 0.12 },
  },
  {
    name: 'Poison cloud',
    kind: 'marker',
    assetType: 'effect',
    color: '#8bd6a2',
    size: 4,
    effect: { shape: 'circle', opacity: 0.16 },
  },
  {
    name: 'Hazard zone',
    kind: 'marker',
    assetType: 'effect',
    color: '#e77f99',
    size: 3,
    effect: { shape: 'square', opacity: 0.14 },
  },
];
const statuses = [
  ['Hidden', '#94a3b8'],
  ['Restrained', '#ad8ff6'],
  ['Vulnerable', '#f07d9b'],
  ['Blessed', '#f6d65f'],
  ['Poisoned', '#81d7a1'],
  ['Burning', '#fa9564'],
] as const;

export function RoomTray({
  tab,
  onTab,
  scenes,
  sceneId,
  party,
  selected,
  gm,
  onScene,
  onNewForest,
  onAdd,
  onDragAsset,
  onLibrary,
  onStatus,
  onTool,
  onUploadMap,
}: {
  tab: TrayTab;
  onTab: (tab: TrayTab) => void;
  scenes: MapScene[];
  sceneId: string;
  party: SheetEntry[];
  selected: MapToken | null;
  gm: boolean;
  onScene: (id: string) => void;
  onNewForest: () => void;
  onAdd: (asset: TokenAsset) => void;
  onDragAsset: (asset: TokenAsset | null) => void;
  onLibrary: () => void;
  onStatus: (name: string, color: string) => void;
  onTool: (tool: Tool) => void;
  onUploadMap: (url: string, width: number, height: number, name: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const [assets, setAssets] = useState<RoomAsset[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [customStatus, setCustomStatus] = useState('');
  const [customColor, setCustomColor] = useState('#78c4f0');
  function refresh() {
    return api<{ assets: RoomAsset[] }>(`/api/campaigns/${encodeURIComponent(getActiveCampaign().id)}/assets`).then((result) =>
      setAssets(result.assets.filter((a) => a.mediaType.startsWith('image/'))),
    );
  }
  useEffect(() => {
    if (gm) void refresh().catch((e) => setError(e.message));
  }, [gm]);
  const q = search.trim().toLowerCase(),
    matches = (name: string) => name.toLowerCase().includes(q);
  const category = categories.find((c) => c.id === tab)!;
  const tokenCard = (asset: TokenAsset) => (
    <button
      key={`${asset.name}-${asset.refId ?? ''}`}
      style={asset.effect ? { color: asset.color } : undefined}
      className={`room-asset ${asset.effect ? 'room-effect-asset' : ''}`}
      draggable={gm}
      disabled={!gm || !sceneId}
      aria-label={`Add ${asset.name}`}
      title={`Click to add ${asset.name} · drag to place`}
      onClick={() => onAdd(asset)}
      onDragStart={(e) => {
        onDragAsset(asset);
        e.dataTransfer.setData('application/x-daggery-asset', asset.name);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDragEnd={() => onDragAsset(null)}
    >
      {asset.image ? (
        <img src={asset.image} alt="" draggable={false} />
      ) : (
        <RoomIcon name={asset.effect ? 'effects' : 'players'} size={32} />
      )}
      <span style={asset.effect ? { color: asset.color } : undefined}>{asset.name}</span>
    </button>
  );
  const tokens =
    tab === 'animals'
      ? animals
      : tab === 'effects'
        ? effects
        : tab === 'miniatures'
          ? party.map((s) => ({
              name: s.name,
              kind: 'character' as const,
              image: s.image,
              refId: s.id,
              color: '#bb9c78',
              hp: s.hp,
              stress: s.stress,
            }))
          : assets.map((a) => ({
              name: a.name,
              kind: 'marker' as const,
              assetType: 'prop' as const,
              color: '#b6c1b0',
              image: `/api/campaigns/${encodeURIComponent(getActiveCampaign().id)}/assets/${encodeURIComponent(a.id)}`,
            }));
  async function upload(file: File) {
    setBusy(true);
    setError('');
    try {
      const url = await uploadAsset(file);
      if (tab === 'maps') {
        const img = new Image();
        img.src = url;
        await img.decode();
        onUploadMap(url, img.naturalWidth, img.naturalHeight, file.name.replace(/\.[^.]+$/, ''));
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`room-tray room-surface ${collapsed ? 'is-collapsed' : ''}`} aria-label="Scene asset tray">
      {!collapsed && (
        <div className="room-tray-content">
          {tab === 'maps' ? (
            <div className="room-asset-row">
              {scenes
                .filter((s) => matches(s.name))
                .map((s) => (
                  <button
                    key={s.id}
                    className="room-asset room-map-asset"
                    aria-label={`View ${s.name}`}
                    aria-pressed={s.id === sceneId}
                    onClick={() => onScene(s.id)}
                  >
                    {s.mapUrl ? <img src={s.mapUrl} alt="" draggable={false} /> : <RoomIcon name="grid" size={30} />}
                    <span>{s.name}</span>
                  </button>
                ))}
              {gm && matches('Rocky forest') && (
                <button
                  className="room-asset room-map-asset room-new-map"
                  onClick={onNewForest}
                  aria-label="Create Rocky forest scene"
                >
                  <img src="/maps/rocky-forest.png" alt="" />
                  <span>
                    <RoomIcon name="plus" size={12} />
                    Rocky forest
                  </span>
                </button>
              )}
            </div>
          ) : tab === 'statuses' ? (
            <div className="room-status-tray">
              <div className="room-status-chips">
                {statuses
                  .filter(([name]) => matches(name))
                  .map(([name, color]) => (
                    <button
                      key={name}
                      disabled={!selected || !!selected.effect || !gm}
                      aria-label={`Toggle ${name} status`}
                      aria-pressed={!!selected?.conditions.includes(name)}
                      style={{ '--status-color': color } as React.CSSProperties}
                      onClick={() => onStatus(name, color)}
                    >
                      <RoomIcon name="statuses" size={17} />
                      {name}
                    </button>
                  ))}
              </div>
              <form
                className="room-custom-status"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (customStatus.trim()) {
                    onStatus(customStatus.trim(), customColor);
                    setCustomStatus('');
                  }
                }}
              >
                <input
                  aria-label="Custom status name"
                  placeholder="Custom status…"
                  maxLength={32}
                  value={customStatus}
                  onChange={(e) => setCustomStatus(e.target.value)}
                />
                <input
                  type="color"
                  aria-label="Custom status color"
                  value={customColor}
                  onChange={(e) => setCustomColor(e.target.value)}
                />
                <button
                  type="submit"
                  aria-label="Attach custom status"
                  disabled={!selected || !!selected.effect || !customStatus.trim() || !gm}
                >
                  <RoomIcon name="plus" size={17} />
                </button>
                <small>
                  {selected && !selected.effect ? `Attached to ${selected.name}` : 'Select a miniature to attach a status.'}
                </small>
              </form>
            </div>
          ) : tab === 'notes' ? (
            <div className="room-notes-tray">
              <button className="room-action" disabled={!gm || !sceneId} onClick={() => onTool('text')}>
                <RoomIcon name="text" />
                Place text on map
              </button>
              <p>
                Choose the text tool, then tap anywhere on the scene.
                <br />
                Select a note to move or edit it.
              </p>
            </div>
          ) : (
            <div className="room-asset-row">
              {tokens.filter((t) => matches(t.name)).map(tokenCard)}
              {(tab === 'miniatures' || tab === 'props') && (
                <button
                  className="room-asset room-library-asset"
                  onClick={onLibrary}
                  disabled={!gm || !sceneId}
                  aria-label="Open miniature library"
                >
                  <RoomIcon name="plus" size={25} />
                  <span>{tab === 'miniatures' ? 'Browse library' : 'Custom marker'}</span>
                </button>
              )}
              {!tokens.length && tab === 'miniatures' && (
                <p className="room-muted">Your character sheets appear here. Browse the library for adversaries.</p>
              )}
              {!tokens.length && tab === 'props' && <p className="room-muted">Upload an image to use as a prop.</p>}
            </div>
          )}
        </div>
      )}
      <div className="room-tray-bar">
        <button className="room-tray-source" onClick={onLibrary} disabled={!gm || !sceneId}>
          <RoomIcon name="library" size={16} />
          <span>Campaign assets</span>
        </button>
        <div className="room-tray-categories" role="toolbar" aria-label="Asset categories">
          {categories.map((c) => (
            <button
              key={c.id}
              aria-label={c.label}
              title={c.label}
              aria-pressed={tab === c.id}
              onClick={() => {
                onTab(c.id);
                setCollapsed(false);
                setSearch('');
              }}
            >
              <RoomIcon name={c.icon} />
            </button>
          ))}
        </div>
        {!collapsed && (
          <label className="room-tray-search">
            <RoomIcon name="search" size={17} />
            <input
              aria-label={`Search ${category.label.toLowerCase()}`}
              placeholder={`Search ${category.label.toLowerCase()}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        )}
        {gm && (tab === 'maps' || tab === 'props') && (
          <label className="room-upload room-icon-button" title={tab === 'maps' ? 'Upload map' : 'Upload prop'}>
            <RoomIcon name="upload" size={19} />
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={tab === 'maps' ? 'Upload map' : 'Upload prop'}
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void upload(file);
              }}
            />
          </label>
        )}
        <button
          className="room-collapse"
          aria-label={collapsed ? 'Expand asset tray' : 'Collapse asset tray'}
          onClick={() => setCollapsed((v) => !v)}
        >
          <RoomIcon name={collapsed ? 'up' : 'down'} size={17} />
        </button>
      </div>
      {error && (
        <p role="alert" className="room-tray-error">
          {error}
          <button onClick={() => setError('')} aria-label="Dismiss upload error">
            ×
          </button>
        </p>
      )}
    </section>
  );
}
