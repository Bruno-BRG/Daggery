import { lazy } from 'react';
import { getRuleset, normalizeConfiguration, type CampaignConfiguration } from '@daggery/shared';
import { DiceTray, DiceOverlay } from '../dice3d';
import type { SystemUI } from './types';
export const DAGGERHEART_UI: SystemUI = { optionsEditor: DaggerheartOptions, diceTray: DiceTray, diceOverlay: DiceOverlay, modules: [
    { id: 'ai', feature: 'daggerheart.ai-gm', label: 'Adventure', icon: 'scroll', description: 'Play with your connected AI Game Master', controller: 'ai', primary: true, component: lazy(() => import('../modules/ai')) },
    { id: 'journal', feature: 'daggerheart.ai-gm', label: 'Journal', icon: 'book', description: 'Chapters, notes and events from your adventure', controller: 'ai', component: lazy(() => import('../modules/journal')) },
    { id: 'map', feature: 'daggerheart.table', label: 'Game table', icon: 'map', description: 'Maps, miniatures, and combat in one place', primaryRulesets: ['core'], component: lazy(() => import('../modules/map')) },
    { id: 'sheets', feature: 'daggerheart.sheets', label: 'Characters', icon: 'sheet', description: 'Create heroes and manage their sheets', primary: true, component: lazy(() => import('../modules/sheets')) },
    { id: 'compendium', feature: 'daggerheart.compendium', label: 'Compendium', icon: 'book', description: 'Find classes, cards, equipment, and rules', component: lazy(() => import('../modules/compendium')) },
    { id: 'gm', feature: 'daggerheart.gm-tools', label: 'GM tools', icon: 'compass', description: 'Loot tables, setting notes, and scenario preparation', gmOnly: true, component: lazy(() => import('../modules/gm')) },
    { id: 'solo', feature: 'daggerheart.solo', label: 'Solo play', icon: 'spark', description: 'Oracles, scenes, thematic pools, and your journal', gmOnly: true, primary: true, component: lazy(() => import('../modules/solo')) },
  ] };

function DaggerheartOptions({ value, onChange }: { value: CampaignConfiguration; onChange: (value: CampaignConfiguration) => void }) {
  if (getRuleset(value)?.mode !== 'solo') return null;
  const update = (options: Record<string, unknown>) => onChange(normalizeConfiguration({ ...value, options: { ...value.options, ...options } }));
  return <>
    <label>Solo party<select aria-label="Solo party" value={String(value.options.partyMode)} onChange={event => update({ partyMode: event.target.value })}><option value="lone">One hero alone</option><option value="companion">Hero + lightweight companion</option><option value="party">Small party</option></select></label>
    {value.options.partyMode === 'party' && <label>Party size<select aria-label="Party size" value={Number(value.options.partySize)} onChange={event => update({ partySize: Number(event.target.value) })}><option value={2}>2 characters</option><option value={3}>3 characters</option></select></label>}
    <label>Fear pacing<select aria-label="Fear pacing" value={Number(value.options.fearThreshold)} onChange={event => update({ fearThreshold: Number(event.target.value) })}><option value={3}>Standard · activate at 3 Fear</option><option value={5}>Gentler · activate at 5 Fear</option></select></label>
    <p>Private campaign. You control the hero and use oracles to discover the world.</p>
  </>;
}
