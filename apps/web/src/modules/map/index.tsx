import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { useDocs } from '../../sync/store';
import { getActiveCampaign } from '../../campaign-context';
import { readPreference, savePreference } from '../../storage';
import { pendingTableCharacterKey } from '../../table-navigation';

import { CompendiumPicker, type AdversaryEntry, type SheetEntry } from './picker';

import { SceneSettings, TokenEditor } from './panels';

import { SceneCreator, SceneManager, MiniatureRoster } from './TablePanels';

import { copyScene } from './scenes';

import { encounterToken, patchEncounter } from './encounterLink';
import { patchLinkedPools, sheetEntry } from './sheetToken';

import type { Sheet } from '../sheets/types';
import { NO_CONDITIONS, sourceOf, type CombatDoc, type AdversaryDoc, type AdversarySource } from '../combat/model';

import { MapStage } from './MapStage';

import { useRole } from '../../useRole';

import { Dialog } from '../../components/Dialog';

import { useSyncStatus } from '../../sync/store';

import { RoomIcon, type RoomIconName } from './RoomIcon';

import { RoomHome, RoomPlayers, RoomDice, RoomCombat, RoomPdfs, type RoomPanel } from './RoomPanels';

import { RoomTray, type TokenAsset, type TrayTab } from './RoomTray';

import { sceneFromTemplate } from './scenes';

import './map.css';

import './room.css';

import type { MapView, ViewState } from './view';

import {
  NS,
  freeTokenPosition,
  newId,
  normalizeScene,
  normalizeToken,
  type ActiveDoc,
  type FogShape,
  type MapDoc,
  type MapDrawing,
  type MapPing,
  type MapScene,
  type MapToken,
  type Tool,
} from './model';

const CharacterSheet = lazy(() => import('../sheets/SheetView'));
const PING_VISIBLE_MS = 2500;

/** Docs of one kind, picked by id prefix ('scene:', 'token:', ...). */

function collect<T>(items: Record<string, MapDoc>, prefix: string): T[] {
  const out: T[] = [];

  for (const [key, value] of Object.entries(items)) {
    if (key.startsWith(prefix)) out.push(value as unknown as T);
  }

  return out;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return !!target.closest('dialog[open]') || target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export default function MapModule({ author }: { author: string }) {
  const { items, set: rawSet, remove: rawRemove } = useDocs<MapDoc>(NS);

  const syncStatus = useSyncStatus();

  const [role] = useRole();

  const gm = role === 'GM';

  const handle = useRef<MapView | null>(null);

  const itemsRef = useRef(items);

  itemsRef.current = items;

  const [viewId, setViewId] = useState<string | null>(() => readPreference(`daggery:last-scene:${getActiveCampaign().id}`) || null);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [tool, setTool] = useState<Tool>('select');

  const [fogShape, setFogShape] = useState<'rect' | 'poly'>('rect');

  const [snap, setSnap] = useState(true);

  const [showRanges, setShowRanges] = useState(false);

  const [fitKey, setFitKey] = useState(0);

  const [picker, setPicker] = useState(false);

  const sheets = useDocs<Sheet>('sheets');
  const combat = useDocs<CombatDoc>('combat');

  const [roomPanel, setRoomPanel] = useState<RoomPanel | null>(() =>
    window.matchMedia('(min-width: 800px)').matches ? 'players' : null,
  );

  const [creatingScene, setCreatingScene] = useState(false);

  const [zoom, setZoom] = useState(100);

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [trayTab, setTrayTab] = useState<TrayTab>('maps');

  const [drawColor, setDrawColor] = useState('#f7d65b');

  const [drawWidth, setDrawWidth] = useState(4);

  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);

  const [textDraft, setTextDraft] = useState<{ point: { x: number; y: number }; id?: string; text: string } | null>(null);

  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  const draggedAsset = useRef<TokenAsset | null>(null);

  const [notice, setNotice] = useState('');

  type Change = { key: string; before?: MapDoc; after?: MapDoc };

  const history = useRef<{ past: Change[]; future: Change[] }>({ past: [], future: [] });

  const [, refreshHistory] = useState(0);

  const dragOrigins = useRef(new Map<string, MapToken>());

  function remember(key: string, after?: MapDoc, before = itemsRef.current[key]) {
    if (syncStatus !== 'open') return;

    if (JSON.stringify(before) === JSON.stringify(after)) return;

    history.current.past.push({ key, before: before && structuredClone(before), after: after && structuredClone(after) });

    history.current.past = history.current.past.slice(-80);
    history.current.future = [];

    refreshHistory((n) => n + 1);
  }

  function set(key: string, value: MapDoc) {
    remember(key, value);
    rawSet(key, value);
  }

  function remove(key: string) {
    remember(key);
    rawRemove(key);
  }

  function undo(redo = false) {
    const source = redo ? history.current.future : history.current.past;

    const change = source[source.length - 1];

    if (!change) return;

    const expected = redo ? change.before : change.after;

    if (JSON.stringify(itemsRef.current[change.key]) !== JSON.stringify(expected)) {
      setNotice('This item changed since your edit. Undo is unavailable until the table is synced.');
      return;
    }

    source.pop();
    (redo ? history.current.past : history.current.future).push(change);

    const target = redo ? change.after : change.before;

    if (target) rawSet(change.key, target);
    else rawRemove(change.key);

    refreshHistory((n) => n + 1);
    setNotice('');
  }

  const togglePanel = (next: RoomPanel) => setRoomPanel((current) => (current === next ? null : next));

  const scenes = useMemo(
    () =>
      collect<MapScene>(items, 'scene:')
        .map(normalizeScene)

        .sort((a, b) => a.order - b.order),

    [items],
  );

  const activeId = (items.active as ActiveDoc | undefined)?.sceneId ?? null;

  const scene = scenes.find((s) => s.id === (viewId ?? activeId)) ?? scenes[0];

  const sceneId = scene?.id ?? '';
  useEffect(() => {
    if (sceneId) savePreference(`daggery:last-scene:${getActiveCampaign().id}`, sceneId);
  }, [sceneId]);

  const sceneTokens = useMemo(
    () =>
      collect<MapToken>(items, 'token:')
        .map(normalizeToken)

        .filter((t) => t.sceneId === sceneId)

        .map((token) => {
          const linked = token.kind === 'character' && token.refId ? sheetEntry(token.refId, sheets.items[token.refId]) : null;

          const encounter = token.combatRefId ? (combat.items[token.combatRefId] as AdversaryDoc | undefined) : undefined;
          if (encounter?.kind === 'adversary') return encounterToken(token, encounter);
          return linked
            ? { ...token, image: token.image ?? linked.image, hp: linked.hp ?? token.hp, stress: linked.stress ?? token.stress }
            : token;
        }),

    [items, sceneId, sheets.items, combat.items],
  );

  const fog = useMemo(
    () =>
      collect<FogShape>(items, 'fog:')
        .filter((f) => f.sceneId === sceneId)

        .sort((a, b) => a.order - b.order),

    [items, sceneId],
  );

  const pings = useMemo(() => collect<MapPing>(items, 'ping:').filter((p) => p.sceneId === sceneId), [items, sceneId]);

  const drawings = useMemo(() => collect<MapDrawing>(items, 'drawing:').filter((d) => d.sceneId === sceneId), [items, sceneId]);

  const selectedDrawing = drawings.find((d) => d.id === selectedDrawingId);

  const party = useMemo(
    () =>
      Object.entries(sheets.items)
        .map(([id, value]) => sheetEntry(id, value))
        .filter((entry): entry is SheetEntry => !!entry),
    [sheets.items],
  );

  const selected = sceneTokens.find((t) => t.id === selectedId && (gm || !t.hidden)) ?? null;

  const previousSceneId = useRef(sceneId);
  useEffect(() => {
    if (previousSceneId.current === sceneId) return;
    previousSceneId.current = sceneId;
    setSelectedId(null);
    setSelectedDrawingId(null);
    history.current = { past: [], future: [] };
    refreshHistory((n) => n + 1);
  }, [sceneId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Players cannot use GM-only tools; fall back to selection when the role switches.

  useEffect(() => {
    if (!gm && tool !== 'select' && tool !== 'ruler' && tool !== 'pan') setTool('select');
  }, [gm, tool]);

  const patchToken = (id: string, patch: Partial<MapToken>) => {
    const cur = itemsRef.current[`token:${id}`] as MapToken | undefined;

    if (cur) {
      if (cur.kind === 'character' && cur.refId && (patch.hp || patch.stress)) {
        const linked = sheets.items[cur.refId];

        if (linked && typeof linked.hpMarked === 'number') sheets.set(cur.refId, patchLinkedPools(linked, patch));
      }

      if (cur.combatRefId) {
        const encounter = combat.items[cur.combatRefId] as AdversaryDoc | undefined;
        if (encounter?.kind === 'adversary' && (patch.hp || patch.stress || patch.conditions)) combat.set(cur.combatRefId, patchEncounter(encounter, patch));
      }

      // Resources linked to a sheet or encounter are owned by that document.
      if (
        (cur.kind === 'character' && cur.refId && (patch.hp || patch.stress)) ||
        (cur.combatRefId && (patch.hp || patch.stress || patch.conditions))
      )
        rawSet(`token:${id}`, { ...cur, ...patch });
      else set(`token:${id}`, { ...cur, ...patch });
    }
  };

  const patchScene = (id: string, patch: Partial<MapScene>) => {
    const cur = itemsRef.current[`scene:${id}`] as MapScene | undefined;

    if (cur) set(`scene:${id}`, { ...cur, ...patch });
  };

  const addToken = (partial: TokenAsset, position?: { x: number; y: number }) => {
    if (!scene) return;

    const center = handle.current?.viewCenterCell() ?? { x: (scene.mapWidth ?? scene.cols * scene.cell) / scene.cell / 2 - (partial.size ?? 1) / 2, y: (scene.mapHeight ?? scene.rows * scene.cell) / scene.cell / 2 - (partial.size ?? 1) / 2 };

    const c =
      position ??
      freeTokenPosition(
        center,
        collect<MapToken>(itemsRef.current, 'token:').filter((token) => token.sceneId === scene.id && !token.effect),
        partial.size ?? 1,
      );

    const id = newId();

    set(`token:${id}`, {
      size: 1,

      hidden: false,

      conditions: [],

      rotation: 0,

      ...partial,

      id,

      sceneId: scene.id,

      x: c.x,

      y: c.y,
    });

    setSelectedId(id);
    setSelectedDrawingId(null);

    setTool('select');
  };

  function placeCombatAdversary(combatRefId: string, source: AdversarySource) {
    const existing = sceneTokens.find((t) => t.combatRefId === combatRefId);
    if (existing) {
      setSelectedId(existing.id);
      handle.current?.focusToken(existing.id);
      return;
    }
    addToken({
      name: source.name,
      kind: 'adversary',
      refId: source.id,
      combatRefId,
      color: '#e28a9b',
      hp: { current: source.hp, max: source.hp },
      stress: source.stress ? { current: source.stress, max: source.stress } : undefined,
    });
  }
  const addAdversary = (adv: AdversaryEntry) => {
    if (!scene) return;
    const combatRefId = `adv:${newId()}`;
    combat.set(combatRefId, {
      kind: 'adversary',
      sceneId,
      catalogId: adv.id,
      name: adv.name,
      addedAt: Date.now(),
      hpMarked: 0,
      stressMarked: 0,
      groupSize: null,
      defeated: 0,
      conditions: { ...NO_CONDITIONS },
      counters: [],
    });
    placeCombatAdversary(combatRefId, adv as AdversarySource);
  };

  const addSheet = (s: SheetEntry) =>
    addToken({ name: s.name, kind: 'character', refId: s.id, image: s.image, color: '#ba9768', hp: s.hp, stress: s.stress });

  useEffect(() => {
    const pending = readPreference(pendingTableCharacterKey());
    if (!gm || !pending) return;
    const entry = party.find((s) => s.id === pending);
    if (!entry) return;
    if (!scene) {
      setCreatingScene(true);
      return;
    }
    savePreference(pendingTableCharacterKey(), '');
    const existing = sceneTokens.find((t) => t.kind === 'character' && t.refId === pending);
    if (existing) {
      setSelectedId(existing.id);
      handle.current?.focusToken(existing.id);
    } else addSheet(entry);
    setTrayTab('miniatures');
    setRoomPanel(null);
  }, [sceneId, gm, party]);

  const rotate = (t: MapToken) => patchToken(t.id, { rotation: (t.rotation + 90) % 360 });

  const duplicate = (t: MapToken) => {
    const id = newId();

    let combatRefId = t.combatRefId;
    if (combatRefId && combat.items[combatRefId]?.kind === 'adversary') {
      const entry = combat.items[combatRefId]!;
      combatRefId = `adv:${newId()}`;
      combat.set(combatRefId, { ...structuredClone(entry), addedAt: Date.now() } as AdversaryDoc);
    }
    set(`token:${id}`, { ...t, combatRefId, id, x: t.x + 1, y: t.y + 1 });

    setSelectedId(id);
  };

  const deleteToken = (id: string) => {
    remove(`token:${id}`);

    setSelectedId(null);
  };

  const activate = (id: string) => set('active', { sceneId: id });

  const deleteScene = (id: string) => {
    remove(`scene:${id}`);

    for (const [key, doc] of Object.entries(itemsRef.current)) {
      const owner = (doc as { sceneId?: string }).sceneId;

      if (
        (key.startsWith('token:') || key.startsWith('fog:') || key.startsWith('ping:') || key.startsWith('drawing:')) &&
        owner === id
      )
        remove(key);
    }
    for (const [key, doc] of Object.entries(combat.items)) {
      if (doc.kind === 'adversary' && doc.sceneId === id) combat.remove(key);
    }

    if (activeId === id) {
      const next = scenes.find((s) => s.id !== id);

      if (next) set('active', { sceneId: next.id });
      else remove('active');
    }

    if (viewId === id) setViewId(null);
  };

  const undoFog = () => {
    const last = fog[fog.length - 1];

    if (last) remove(`fog:${last.id}`);
  };

  const clearFog = () => {
    if (!window.confirm('Clear all fog in this scene?')) return;

    for (const f of fog) remove(`fog:${f.id}`);
  };

  const state: ViewState = {
    scene,

    tokens: sceneTokens,

    fog,

    pings,

    drawings,
    selectedDrawingId,
    drawColor,
    drawWidth,

    role,

    tool,

    fogShape,

    snap,

    showRanges,

    selectedId: selected?.id ?? null,

    fitKey,

    callbacks: {
      onZoomChange: setZoom,

      onSelectionPosition: (point) => setAnchor((old) => (old?.x === point?.x && old?.y === point?.y ? old : point)),

      onSelect: (id) => {
        setSelectedId(id);
        if (id) setSelectedDrawingId(null);
      },

      onMoveToken: (id, x, y, final) => {
        const current = itemsRef.current[`token:${id}`] as MapToken | undefined;

        if (!current || !gm) return;

        if (!dragOrigins.current.has(id)) dragOrigins.current.set(id, structuredClone(current));

        const next = { ...current, x, y };

        if (final) {
          remember(`token:${id}`, next, dragOrigins.current.get(id));
          dragOrigins.current.delete(id);
        }

        rawSet(`token:${id}`, next);
      },

      onDrawingSelect: (id) => {
        setSelectedDrawingId(id);
        if (id) setSelectedId(null);
      },

      onDrawingAdd: (drawing) => {
        if (!scene || !gm) return;

        const id = newId();
        set(`drawing:${id}`, { ...drawing, id, sceneId, color: drawColor, width: drawWidth });
      },

      onDrawingMove: (drawing) => {
        if (gm) set(`drawing:${drawing.id}`, drawing);
      },

      onDrawingErase: (id) => {
        if (gm) {
          remove(`drawing:${id}`);
          if (selectedDrawingId === id) setSelectedDrawingId(null);
        }
      },

      onText: (point) => setTextDraft({ point, text: '' }),

      onFogAdd: (mode, points) => {
        if (!scene || !gm) return;

        const id = newId();

        set(`fog:${id}`, { id, sceneId: scene.id, mode, points, order: Date.now() });
      },

      onAlignGrid: (offsetX, offsetY) => {
        if (scene && gm) patchScene(scene.id, { offsetX, offsetY });
      },

      onPing: (x, y) => {
        if (!scene) return;

        const id = newId();

        rawSet(`ping:${id}`, { id, sceneId: scene.id, x, y, author, at: new Date().toISOString() });

        window.setTimeout(() => rawRemove(`ping:${id}`), PING_VISIBLE_MS);
      },
    },
  };

  // Keyboard shortcuts. Stored in a ref so one listener sees the latest render.

  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});

  onKey.current = (e) => {
    if (isTyping(e.target)) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && gm) {
      e.preventDefault();
      undo(e.shiftKey);
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const k = e.key.toLowerCase();

    if (k === 'escape') {
      setSelectedId(null);
      setSelectedDrawingId(null);
      setRoomPanel(null);
      return;
    }

    if ((k === 'delete' || k === 'backspace') && selectedDrawing && gm) {
      e.preventDefault();
      remove(`drawing:${selectedDrawing.id}`);
      setSelectedDrawingId(null);
      return;
    }

    if ((k === 'delete' || k === 'backspace') && selected && gm) {
      e.preventDefault();

      return deleteToken(selected.id);
    }

    if (k === 'r' && selected) return rotate(selected);

    if (k === 'd' && selected && gm) return duplicate(selected);

    if (k === 'v') return setTool('select');

    if (k === 'p') return setTool('pan');

    if (k === 'm') return setTool('ruler');

    if (gm && k === 'b') return setTool('pen');

    if (gm && k === 't') return setTool('text');

    if (gm && k === 'h') return setTool('fog-hide');

    if (gm && k === 'e') return setTool('fog-reveal');

    if (k === 'a') return setShowRanges((v) => !v);

    if (k === 's') return setSnap((v) => !v);

    if (k === 'f') return setFitKey((n) => n + 1);

    if (gm && k === 'g' && scene) return patchScene(scene.id, { showGrid: !scene.showGrid });
  };

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey.current(e);

    window.addEventListener('keydown', listener);

    return () => window.removeEventListener('keydown', listener);
  }, []);

  const fogTool = tool === 'fog-hide' || tool === 'fog-reveal';

  const drawingTool = ['pen', 'line', 'rect', 'ellipse', 'eraser', 'text'].includes(tool);

  const tools: { id: Tool; icon: RoomIconName; label: string }[] = [
    { id: 'pan', icon: 'pan', label: 'Pan the table (P)' },

    { id: 'select', icon: 'select', label: 'Select & move (V)' },

    ...(gm
      ? [
          { id: 'fog-hide' as Tool, icon: 'fog' as RoomIconName, label: 'Fog of war (H)' },
          { id: 'pen' as Tool, icon: 'pen' as RoomIconName, label: 'Draw on map (B)' },
        ]
      : []),

    { id: 'ruler', icon: 'ruler', label: 'Measure distance (M)' },

    ...(gm
      ? [
          { id: 'eraser' as Tool, icon: 'eraser' as RoomIconName, label: 'Erase drawing' },
          { id: 'text' as Tool, icon: 'text' as RoomIconName, label: 'Write text (T)' },
        ]
      : []),
  ];

  function cloneScene(id: string) {
    const source = scenes.find((item) => item.id === id);

    if (!source) return;

    const cloned = copyScene(
      source,
      collect<MapToken>(itemsRef.current, 'token:'),
      collect<FogShape>(itemsRef.current, 'fog:'),
      collect<MapDrawing>(itemsRef.current, 'drawing:'),
    );

    rawSet(`scene:${cloned.scene.id}`, cloned.scene);

    for (const token of cloned.tokens) {
      if (token.combatRefId && combat.items[token.combatRefId]?.kind === 'adversary') {
        const original = combat.items[token.combatRefId] as AdversaryDoc;
        token.combatRefId = `adv:${newId()}`;
        combat.set(token.combatRefId, { ...structuredClone(original), sceneId: cloned.scene.id, addedAt: Date.now() });
      }
      rawSet(`token:${token.id}`, token);
    }

    for (const area of cloned.fog) rawSet(`fog:${area.id}`, area);

    for (const drawing of cloned.drawings) rawSet(`drawing:${drawing.id}`, drawing);

    setViewId(cloned.scene.id);
  }

  function createScene(created: MapScene) {
    rawSet(`scene:${created.id}`, created);
    setViewId(created.id);
    setSelectedId(null);

    if (!activeId) rawSet('active', { sceneId: created.id });

    setCreatingScene(false);
  }

  function viewScene(id: string) {
    setViewId(id);
    setSelectedId(null);
    setRoomPanel(null);
  }

  function toggleStatus(name: string, color: string) {
    if (!selected || !gm || selected.effect) return;

    const conditions = selected.conditions.includes(name)
      ? selected.conditions.filter((c) => c !== name)
      : [...selected.conditions, name];

    patchToken(selected.id, { conditions, statusColors: { ...selected.statusColors, [name]: color } });
  }

  const linked = !!(selected?.kind === 'character' && selected.refId && sheets.items[selected.refId]);

  const leftButtons: { id: RoomPanel; icon: RoomIconName; label: string }[] = [
    { id: 'room', icon: 'home', label: 'Room menu' },
    { id: 'players', icon: 'players', label: 'Players' },

    { id: 'dice', icon: 'dice', label: 'Dice rolls' },
    { id: 'combat', icon: 'combat', label: 'Combat' },
    { id: 'pdf', icon: 'pdf', label: 'PDF references' },
  ];

  const titles: Record<RoomPanel, string> = {
    room: 'Your table',
    players: 'Players',
    dice: 'Dice rolls',
    combat: 'Combat',
    pdf: 'PDF references',
    scenes: 'Scenes',
    miniatures: 'On the table',
  };

  const contextStyle = anchor
    ? {
        left: `clamp(200px, ${anchor.x}px, calc(100% - 250px))`,
        top: `${Math.max(92, Math.min(anchor.y + 22, window.innerHeight - 235))}px`,
      }
    : undefined;

  return (
    <div className="daggery-map room-workspace">
      {!gm && (
        <p role="status" className="room-player-notice">
          Player map sharing is not available in this version. Use the left menu for dice, combat, and your campaign.
        </p>
      )}

      <div
        className="room-canvas"
        onDragOver={(e) => {
          if (draggedAsset.current && gm && scene) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(e) => {
          const asset = draggedAsset.current;
          draggedAsset.current = null;

          if (!asset || !gm || !scene) return;

          e.preventDefault();
          const point = handle.current?.clientToCell(e.clientX, e.clientY);
          if (point) addToken(asset, point);
        }}
      >
        {scene ? (
          <MapStage state={state} handle={handle} />
        ) : (
          <div className="room-welcome">
            <RoomIcon name="maps" size={42} />
            <p>YOUR NEXT ADVENTURE</p>
            <h1>
              A world waiting
              <br />
              to come alive.
            </h1>
            <span>Start with a map. Bring your party.</span>
            {gm && (
              <button className="room-primary" onClick={() => setCreatingScene(true)}>
                <RoomIcon name="plus" size={18} />
                Create a scene
              </button>
            )}
          </div>
        )}
      </div>

      <div className="room-left-chrome">
        <nav className="room-nav room-surface" aria-label="Room panels">
          {leftButtons.map((button) => (
            <button
              key={button.id}
              aria-label={button.label}
              title={button.label}
              aria-expanded={roomPanel === button.id}
              aria-pressed={roomPanel === button.id}
              onClick={() => togglePanel(button.id)}
            >
              <RoomIcon name={button.icon} />
            </button>
          ))}
        </nav>

        {roomPanel && (
          <aside className={`room-panel room-surface room-panel-${roomPanel}`} aria-label={titles[roomPanel]}>
            <header>
              <h2>{titles[roomPanel]}</h2>
              <button aria-label="Close room panel" onClick={() => setRoomPanel(null)}>
                <RoomIcon name="close" size={17} />
              </button>
            </header>
            <div className="room-panel-content">
              {roomPanel === 'room' && (
                <RoomHome
                  onScenes={() => setRoomPanel('scenes')}
                  onSettings={() => {
                    setSelectedId(null);
                    setInspectorOpen(true);
                  }}
                />
              )}

              {roomPanel === 'players' && <RoomPlayers />}

              {roomPanel === 'dice' && <RoomDice author={author} />}

              {roomPanel === 'combat' && <RoomCombat author={author} sceneId={sceneId} onPlace={placeCombatAdversary} />}

              {roomPanel === 'pdf' && <RoomPdfs />}

              {roomPanel === 'scenes' &&
                (gm ? (
                  <SceneManager
                    scenes={scenes}
                    sceneId={sceneId}
                    activeId={activeId}
                    onView={viewScene}
                    onActivate={activate}
                    onCreate={() => setCreatingScene(true)}
                    onRename={(id, name) => patchScene(id, { name })}
                    onDuplicate={cloneScene}
                    onDelete={deleteScene}
                  />
                ) : (
                  <p className="room-muted">Your Game Master manages the scenes.</p>
                ))}

              {roomPanel === 'miniatures' && (
                <MiniatureRoster
                  tokens={sceneTokens.filter((t) => gm || !t.hidden)}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    setSelectedId(id);
                    handle.current?.focusToken(id);
                  }}
                  onAdd={gm && scene ? () => setPicker(true) : undefined}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      <div className="room-scene-label room-surface">
        <button aria-label="Manage scenes" onClick={() => togglePanel('scenes')}>
          <RoomIcon name="maps" size={16} />
          <span>{scene?.name ?? 'The game table'}</span>
          <RoomIcon name="down" size={13} />
        </button>
        <i
          className={syncStatus === 'open' ? 'is-live' : ''}
          title={syncStatus === 'open' ? 'Table synced' : 'Connecting to table'}
        />
        <span className="room-scene-role">{gm ? 'GM' : 'Player'}</span>
      </div>

      {scene && (
        <>
          <div className="room-right-chrome">
            <button
              className="room-scene-settings room-surface"
              aria-label="Scene settings"
              title="Scene settings"
              onClick={() => {
                setSelectedId(null);
                setInspectorOpen(true);
              }}
            >
              <RoomIcon name="settings" size={19} />
            </button>

            <div className="room-tools room-surface" role="toolbar" aria-label="Map tools">
              {tools.map((item) => (
                <button
                  key={item.id}
                  aria-label={item.label}
                  title={item.label}
                  aria-pressed={
                    item.id === 'pen'
                      ? ['pen', 'line', 'rect', 'ellipse'].includes(tool)
                      : item.id === 'fog-hide'
                        ? fogTool
                        : tool === item.id
                  }
                  onClick={() => setTool(item.id)}
                >
                  <RoomIcon name={item.icon} />
                </button>
              ))}
              <span className="room-tool-divider" />
              <button
                aria-label="Undo last edit"
                title="Undo (Ctrl Z)"
                disabled={!gm || !history.current.past.length}
                onClick={() => undo()}
              >
                <RoomIcon name="undo" />
              </button>
              <button
                aria-label="Redo last edit"
                title="Redo (Ctrl Shift Z)"
                disabled={!gm || !history.current.future.length}
                onClick={() => undo(true)}
              >
                <RoomIcon name="redo" />
              </button>
            </div>
          </div>

          {drawingTool && gm && (
            <div className="room-tool-options room-surface" aria-label="Drawing options">
              {tool !== 'eraser' && (
                <>
                  <label title="Drawing color">
                    <input
                      type="color"
                      aria-label="Drawing color"
                      value={drawColor}
                      onChange={(e) => setDrawColor(e.target.value)}
                    />
                  </label>
                  <label className="room-width">
                    Width
                    <select aria-label="Stroke width" value={drawWidth} onChange={(e) => setDrawWidth(Number(e.target.value))}>
                      {[2, 4, 8, 12].map((width) => (
                        <option key={width} value={width}>
                          {width}px
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {!['text', 'eraser'].includes(tool) &&
                (['pen', 'line', 'rect', 'ellipse'] as const).map((shape) => (
                  <button
                    key={shape}
                    title={shape}
                    aria-label={`Draw ${shape}`}
                    aria-pressed={tool === shape}
                    onClick={() => setTool(shape)}
                  >
                    <RoomIcon name={shape} size={18} />
                  </button>
                ))}
              <small>
                {tool === 'eraser'
                  ? 'Tap a stroke or note to erase it.'
                  : tool === 'text'
                    ? 'Tap the map to place text.'
                    : 'Drag on the map to draw.'}
              </small>
            </div>
          )}

          {fogTool && gm && (
            <div className="room-tool-options room-fog-options room-surface">
              <button aria-pressed={tool === 'fog-hide'} onClick={() => setTool('fog-hide')}>
                Hide
              </button>
              <button aria-pressed={tool === 'fog-reveal'} onClick={() => setTool('fog-reveal')}>
                Reveal
              </button>
              <select aria-label="Fog shape" value={fogShape} onChange={(e) => setFogShape(e.target.value as 'rect' | 'poly')}>
                <option value="rect">Rectangle</option>
                <option value="poly">Polygon</option>
              </select>
              <button disabled={!fog.length} onClick={clearFog} aria-label="Clear fog">
                <RoomIcon name="trash" size={17} />
              </button>
              <small>{fogShape === 'poly' ? 'Tap points, then Enter to finish.' : 'Drag an area on the map.'}</small>
            </div>
          )}

          {selected && (
            <div className="room-context room-surface" style={contextStyle} aria-label={`${selected.name} actions`}>
              <span className="room-context-name">{selected.name}{selected.conditions.length > 0 && ` · ${selected.conditions.join(' · ')}`}</span>
              <div>
                <button
                  aria-label={selected.hidden ? 'Show miniature' : 'Hide miniature'}
                  title={selected.hidden ? 'Show miniature' : 'Hide miniature'}
                  disabled={!gm}
                  aria-pressed={selected.hidden}
                  onClick={() => patchToken(selected.id, { hidden: !selected.hidden })}
                >
                  <RoomIcon name={selected.hidden ? 'eyeOff' : 'eye'} size={20} />
                </button>

                <button
                  aria-label={selected.locked ? 'Unlock miniature' : 'Lock miniature'}
                  title="Lock position"
                  disabled={!gm}
                  aria-pressed={!!selected.locked}
                  onClick={() => patchToken(selected.id, { locked: !selected.locked })}
                >
                  <RoomIcon name={selected.locked ? 'lock' : 'unlock'} size={20} />
                </button>

                <button aria-label={`Rotate ${selected.name}`} title="Rotate (R)" disabled={!gm} onClick={() => rotate(selected)}>
                  <RoomIcon name="rotate" size={20} />
                </button>

                {linked && (
                  <button
                    aria-label={`Open ${selected.name} character sheet`}
                    title="Open live character sheet"
                    onClick={() => setSheetOpen(true)}
                  >
                    <RoomIcon name="players" size={20} />
                  </button>
                )}
                <button
                  aria-label="Attach a status"
                  title="Attached statuses"
                  disabled={!gm || !!selected.effect}
                  onClick={() => setTrayTab('statuses')}
                >
                  <RoomIcon name="statuses" size={20} />
                </button>

                <button
                  aria-label={`Duplicate ${selected.name}`}
                  title="Duplicate (D)"
                  disabled={!gm}
                  onClick={() => duplicate(selected)}
                >
                  <RoomIcon name="copy" size={20} />
                </button>

                <button aria-label={`Edit ${selected.name}`} title="Edit details" onClick={() => setInspectorOpen(true)}>
                  <RoomIcon name="settings" size={20} />
                </button>

                <button
                  aria-label={`Remove ${selected.name}`}
                  title="Remove (Delete)"
                  disabled={!gm}
                  onClick={() => deleteToken(selected.id)}
                >
                  <RoomIcon name="trash" size={20} />
                </button>

                <button aria-label="Deselect miniature" title="Deselect" onClick={() => setSelectedId(null)}>
                  <RoomIcon name="close" size={17} />
                </button>
              </div>
            </div>
          )}

          {selectedDrawing && (
            <div className="room-drawing-context room-surface">
              <strong>{selectedDrawing.kind === 'text' ? 'Text note' : 'Drawing'}</strong>
              {selectedDrawing.kind === 'text' && (
                <button
                  onClick={() =>
                    setTextDraft({
                      id: selectedDrawing.id,
                      point: { x: selectedDrawing.points[0]!, y: selectedDrawing.points[1]! },
                      text: selectedDrawing.text ?? '',
                    })
                  }
                >
                  Edit text
                </button>
              )}
              <label>
                <input
                  type="color"
                  aria-label="Selected drawing color"
                  value={selectedDrawing.color}
                  disabled={!gm}
                  onChange={(e) => set(`drawing:${selectedDrawing.id}`, { ...selectedDrawing, color: e.target.value })}
                />
              </label>
              <button
                aria-label="Remove selected drawing"
                disabled={!gm}
                onClick={() => {
                  remove(`drawing:${selectedDrawing.id}`);
                  setSelectedDrawingId(null);
                }}
              >
                <RoomIcon name="trash" size={18} />
              </button>
              <button aria-label="Deselect drawing" onClick={() => setSelectedDrawingId(null)}>
                <RoomIcon name="close" size={17} />
              </button>
            </div>
          )}

          <div className="room-display room-surface" role="group" aria-label="Map display">
            <button
              aria-label="Toggle grid"
              title="Grid (G)"
              disabled={!gm}
              aria-pressed={scene.showGrid}
              onClick={() => patchScene(scene.id, { showGrid: !scene.showGrid })}
            >
              <RoomIcon name="grid" size={18} />
            </button>
            <button aria-label="Snap to grid" title="Snap to grid (S)" aria-pressed={snap} onClick={() => setSnap((v) => !v)}>
              <RoomIcon name="snap" size={18} />
            </button>
            <button
              aria-label="Show range bands"
              title="Range bands (A)"
              aria-pressed={showRanges}
              onClick={() => setShowRanges((v) => !v)}
            >
              <RoomIcon name="target" size={18} />
            </button>
            <button aria-label="Miniature roster" title="On the table" onClick={() => togglePanel('miniatures')}>
              <RoomIcon name="players" size={18} />
            </button>
          </div>

          <div className="room-zoom room-surface">
            <button aria-label="Zoom out" onClick={() => handle.current?.zoomBy(1 / 1.25)}>
              <RoomIcon name="minus" size={16} />
            </button>
            <button aria-label="Fit scene" title="Fit scene (F)" onClick={() => setFitKey((n) => n + 1)}>
              {zoom}%
            </button>
            <button aria-label="Zoom in" onClick={() => handle.current?.zoomBy(1.25)}>
              <RoomIcon name="plus" size={16} />
            </button>
            <button aria-label="Center scene" onClick={() => setFitKey((n) => n + 1)}>
              <RoomIcon name="fit" size={17} />
            </button>
          </div>
        </>
      )}

      <RoomTray
        tab={trayTab}
        onTab={setTrayTab}
        scenes={scenes}
        sceneId={sceneId}
        party={party}
        selected={selected}
        gm={gm}
        onScene={viewScene}
        onNewForest={() => createScene(sceneFromTemplate('rocky-forest', 'Rocky forest'))}
        onAdd={addToken}
        onDragAsset={(asset) => {
          draggedAsset.current = asset;
        }}
        onLibrary={() => setPicker(true)}
        onStatus={toggleStatus}
        onTool={setTool}
        onUploadMap={(url, width, height, name) =>
          createScene({
            ...sceneFromTemplate('midnight', name),
            mapUrl: url,
            mapWidth: width,
            mapHeight: height,
            showGrid: false,
          })
        }
      />

      {notice && (
        <div role="status" className="room-notice room-surface">
          {notice}
        </div>
      )}

      <Dialog
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        title={selected ? selected.name : 'Scene settings'}
        className="vtt-inspector-dialog room-dialog"
      >
        <div className="vtt-inspector-content">
          {selected?.effect ? (
            <div className="room-effect-form">
              <label>
                Name
                <input value={selected.name} onChange={(e) => patchToken(selected.id, { name: e.target.value })} maxLength={80} />
              </label>
              <label>
                Diameter in cells
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={selected.size}
                  onChange={(e) => {
                    const size = e.target.valueAsNumber;
                    if (Number.isFinite(size)) patchToken(selected.id, { size: Math.max(1, Math.min(40, size)) });
                  }}
                />
              </label>
              <label>
                Shape
                <select
                  value={selected.effect.shape}
                  onChange={(e) =>
                    patchToken(selected.id, {
                      effect: { ...selected.effect!, shape: e.target.value as 'circle' | 'cone' | 'square' },
                    })
                  }
                >
                  <option value="circle">Circle</option>
                  <option value="cone">Cone</option>
                  <option value="square">Square</option>
                </select>
              </label>
              <label>
                Color
                <input type="color" value={selected.color} onChange={(e) => patchToken(selected.id, { color: e.target.value })} />
              </label>
              <label>
                Fill opacity
                <input
                  type="range"
                  min="0"
                  max="0.5"
                  step="0.01"
                  value={selected.effect.opacity}
                  onChange={(e) => patchToken(selected.id, { effect: { ...selected.effect!, opacity: Number(e.target.value) } })}
                />
              </label>
            </div>
          ) : selected ? (
            <TokenEditor
              token={selected}
              gm={gm}
              linked={linked}
              onPatch={(patch) => patchToken(selected.id, patch)}
              onRotate={() => rotate(selected)}
              onDuplicate={() => duplicate(selected)}
              onDelete={() => {
                deleteToken(selected.id);
                setInspectorOpen(false);
              }}
            />
          ) : gm && scene ? (
            <>
              <SceneSettings scene={scene} onPatch={(patch) => patchScene(scene.id, patch)} />
              <button
                className="room-action"
                onClick={() => {
                  setTool('align');
                  setInspectorOpen(false);
                }}
              >
                Align grid on map
              </button>
            </>
          ) : (
            <p>Create a scene to configure its map.</p>
          )}
        </div>
      </Dialog>

      <Dialog
        open={sheetOpen && !!selected?.refId && !!sheets.items[selected.refId]}
        onClose={() => setSheetOpen(false)}
        title={selected?.name ?? 'Character sheet'}
        className="room-character-dialog room-dialog"
      >
        {selected?.refId && sheets.items[selected.refId] && (
          <Suspense fallback={<p>Loading character sheet…</p>}>
            <CharacterSheet
              sheet={sheets.items[selected.refId]!}
              author={author}
              backLabel="Back to table"
              onBack={() => setSheetOpen(false)}
              onChange={(sheet) => sheets.set(sheet.id, sheet)}
              onDelete={() => {
                sheets.remove(selected.refId!);
                setSheetOpen(false);
              }}
            />
          </Suspense>
        )}
      </Dialog>
      <Dialog
        open={!!textDraft}
        onClose={() => setTextDraft(null)}
        title={textDraft?.id ? 'Edit map text' : 'Write on the map'}
        className="room-dialog"
      >
        <form
          className="room-text-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!textDraft?.text.trim() || !scene || !gm) return;

            const id = textDraft.id ?? newId(),
              previous = textDraft.id ? selectedDrawing : undefined;

            set(`drawing:${id}`, {
              id,
              sceneId,
              kind: 'text',
              points: [textDraft.point.x, textDraft.point.y],
              text: textDraft.text.trim(),
              color: previous?.color ?? drawColor,
              width: 0,
              fontSize: previous?.fontSize ?? 28,
            });

            setTextDraft(null);
            setTool('select');
            setSelectedDrawingId(id);
            setSelectedId(null);
          }}
        >
          <label>
            Text
            <textarea
              data-autofocus
              aria-label="Map text"
              maxLength={500}
              rows={4}
              value={textDraft?.text ?? ''}
              onChange={(e) => setTextDraft((draft) => (draft ? { ...draft, text: e.target.value } : null))}
            />
          </label>
          <p>Your text stays anchored to the map as you pan and zoom.</p>
          <button className="room-primary" type="submit" disabled={!textDraft?.text.trim()}>
            Save text
          </button>
        </form>
      </Dialog>

      {creatingScene && <SceneCreator onClose={() => setCreatingScene(false)} onCreate={createScene} />}

      {picker && scene && (
        <CompendiumPicker
          onClose={() => setPicker(false)}
          onAdversary={addAdversary}
          onSheet={addSheet}
          onMarker={(marker) => addToken({ ...marker, kind: 'marker' })}
        />
      )}
    </div>
  );
}
