import type { CampaignConfiguration, GameSystemDefinition } from './types';
import { DAGGERHEART } from './daggerheart/definition';
export type * from './types';
export const GAME_SYSTEMS: readonly GameSystemDefinition[] = [DAGGERHEART];
export const DEFAULT_CONFIGURATION: CampaignConfiguration = { systemId: 'daggerheart', rulesetId: 'solo', options: { partyMode: 'lone', fearThreshold: 3, partySize: 2 } };
export function getGameSystem(id: string) { return GAME_SYSTEMS.find(system => system.id === id); }
export function getRuleset(configuration: Pick<CampaignConfiguration, 'systemId' | 'rulesetId'>) {
  return getGameSystem(configuration.systemId)?.rulesets.find(ruleset => ruleset.id === configuration.rulesetId);
}
export function normalizeConfiguration(value: unknown = DEFAULT_CONFIGURATION): CampaignConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid campaign configuration');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !['systemId', 'rulesetId', 'options', 'gmController'].includes(key)) || typeof data.systemId !== 'string' || typeof data.rulesetId !== 'string') throw new Error('Invalid campaign configuration');
  // Daggery is solo only. Legacy group campaigns used the removed 'core' ruleset; open them as
  // solo with the default options so people keep their documents and notes.
  const legacySolo = data.systemId === 'daggerheart' && data.rulesetId === 'core';
  const rulesetId = legacySolo ? 'solo' : data.rulesetId;
  const ruleset = getRuleset({ systemId: data.systemId, rulesetId });
  if (!ruleset) throw new Error('Invalid or unsupported game system/ruleset');
  const options = legacySolo ? {} : data.options ?? {};
  if (typeof options !== 'object' || options === null || Array.isArray(options)) throw new Error('Invalid ruleset options');
  // Older campaigns may still carry gmController from the removed AI Game Master; it is dropped.
  return { systemId: data.systemId, rulesetId, options: ruleset.normalizeOptions(options as Record<string, unknown>) };
}
export function hasFeature(configuration: CampaignConfiguration, feature: string) { return getRuleset(configuration)?.features.includes(feature) ?? false; }
export function canReadDocument(configuration: CampaignConfiguration, role: 'gm' | 'player', ns: string, id: string) {
  const policy = getRuleset(configuration)?.documents.find(entry => entry.namespace === ns);
  return !!policy && (role === 'gm' || policy.read === 'members' || !!policy.publicIds?.includes(id));
}
export function canWriteDocument(configuration: CampaignConfiguration, role: 'gm' | 'player', ns: string, id?: string) {
  const policy = getRuleset(configuration)?.documents.find(entry => entry.namespace === ns);
  return !!policy && !policy.protectedIds?.includes(id ?? '') && policy.write !== 'server' && (role === 'gm' || policy.write === 'members');
}
export function isRealtimeDocument(configuration: CampaignConfiguration, ns: string, id: string) {
  const policy = getRuleset(configuration)?.documents.find(entry => entry.namespace === ns);
  return !!policy && (!policy.realtimeIds || policy.realtimeIds.includes(id));
}
