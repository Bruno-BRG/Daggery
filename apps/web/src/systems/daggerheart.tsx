import { lazy } from 'react';
import { getRuleset, normalizeConfiguration, type CampaignConfiguration } from '@daggery/shared';
import { DiceTray, DiceOverlay } from '../dice3d';
import type { SystemUI } from './types';
import { DaggerheartTrackers } from './Trackers';
export const DAGGERHEART_UI: SystemUI = { optionsEditor: DaggerheartOptions, diceTray: DiceTray, diceOverlay: DiceOverlay,
  statusItem: { feature: 'daggerheart.duality', component: DaggerheartTrackers },
  // Oracles, moves and results beside the character sheet and every other page, not a page of their own.
  companion: { feature: 'daggerheart.solo', label: 'Solo screen', icon: 'spark', gmOnly: true, component: lazy(() => import('../modules/solo')) },
  modules: [
    { id: 'campaign', feature: 'daggerheart.gm-tools', label: 'Campaign', icon: 'compass', description: 'Setting, people, places, threads and loot', primary: true, component: lazy(() => import('../modules/campaign')) },
    { id: 'sheets', feature: 'daggerheart.sheets', label: 'Characters', icon: 'sheet', description: 'Create heroes and manage their sheets', primary: true, component: lazy(() => import('../modules/sheets')) },
    { id: 'challenges', feature: 'daggerheart.sheets', label: 'Challenges', icon: 'target', description: 'Vows, journeys, scenes and countdowns', primary: true, component: lazy(() => import('../modules/challenges')) },
    { id: 'compendium', feature: 'daggerheart.compendium', label: 'Compendium', icon: 'book', description: 'Find classes, cards, equipment, and rules', component: lazy(() => import('../modules/compendium')) },
  ] };

function DaggerheartOptions({ value, onChange }: { value: CampaignConfiguration; onChange: (value: CampaignConfiguration) => void }) {
  if (getRuleset(value)?.mode !== 'solo') return null;
  const update = (options: Record<string, unknown>) => onChange(normalizeConfiguration({ ...value, options: { ...value.options, ...options } }));
  return <>
    <label>Who you play<select aria-label="Who you play" value={String(value.options.partyMode)} onChange={event => update({ partyMode: event.target.value })}><option value="lone">One hero alone</option><option value="companion">Hero + lightweight companion</option><option value="party">Small party</option></select></label>
    {value.options.partyMode === 'party' && <label>Party size<select aria-label="Party size" value={Number(value.options.partySize)} onChange={event => update({ partySize: Number(event.target.value) })}><option value={2}>2 characters</option><option value={3}>3 characters</option></select></label>}
    <label>Fear pacing<select aria-label="Fear pacing" value={Number(value.options.fearThreshold)} onChange={event => update({ fearThreshold: Number(event.target.value) })}><option value={3}>Standard · activate at 3 Fear</option><option value={5}>Gentler · activate at 5 Fear</option></select></label>
  </>;
}
