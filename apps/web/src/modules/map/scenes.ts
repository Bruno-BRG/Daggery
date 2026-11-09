import { newId, newScene, type FogShape, type MapDrawing, type MapScene, type MapToken } from './model';

export const SCENE_TEMPLATES = [
  { id: 'rocky-forest', name: 'Rocky forest', description: 'A woodland clearing, granite cliffs, and a winding stream.', image: '/maps/rocky-forest.png', cols: 25, rows: 16 },
  { id: 'ruins', name: 'Moonfall ruins', description: 'An ancient sanctuary, reclaimed by the forest.', image: '/maps/moonfall-ruins.svg', cols: 24, rows: 16 },
  { id: 'parchment', name: 'A blank page', description: 'A warm parchment grid for your next idea.', image: undefined, cols: 30, rows: 20 },
  { id: 'midnight', name: 'After dark', description: 'A quiet, dark canvas. Anything can happen.', image: undefined, cols: 30, rows: 20 },
] as const;

export function sceneFromTemplate(templateId: string, name: string, cols = 30, rows = 20): MapScene {
  const template = SCENE_TEMPLATES.find(item => item.id === templateId) ?? SCENE_TEMPLATES[3];
  const scene = newScene(name.trim() || template.name, Date.now());
  if (template.id === 'rocky-forest') return { ...scene, cols: 25, rows: 16, cell: 62, mapUrl: template.image, mapWidth: 1586, mapHeight: 992, showGrid: false, boardStyle: 'forest' };
  if (template.id === 'ruins') return { ...scene, cols: 24, rows: 16, mapUrl: template.image, mapWidth: 2400, mapHeight: 1600, showGrid: false, boardStyle: 'forest' };
  return { ...scene, cols: Math.max(4, Math.min(100, Math.round(cols) || 30)), rows: Math.max(4, Math.min(100, Math.round(rows) || 20)), boardStyle: template.id === 'parchment' ? 'parchment' : 'midnight' };
}

/** Copies each scene-owned document with fresh identifiers and independent nested state. */
export function copyScene(source: MapScene, tokens: MapToken[], fog: FogShape[], drawings: MapDrawing[] = []) {
  const scene = { ...structuredClone(source), id: newId(), name: `${source.name} · Copy`, order: Date.now() };
  return {
    scene,
    tokens: tokens.filter(item => item.sceneId === source.id).map(item => ({ ...structuredClone(item), id: newId(), sceneId: scene.id })),
    fog: fog.filter(item => item.sceneId === source.id).map(item => ({ ...structuredClone(item), id: newId(), sceneId: scene.id })),
    drawings: drawings.filter(item => item.sceneId === source.id).map(item => ({ ...structuredClone(item), id: newId(), sceneId: scene.id })),
  };
}
