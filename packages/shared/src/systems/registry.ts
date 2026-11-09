import type { CampaignConfiguration, GameSystemDefinition } from './types';
import { DAGGERHEART } from './daggerheart/definition';
export type * from './types';
export const GAME_SYSTEMS: readonly GameSystemDefinition[] = [DAGGERHEART];
export const DEFAULT_CONFIGURATION: CampaignConfiguration = { systemId: 'daggerheart', rulesetId: 'core', options: {} };
export function getGameSystem(id: string) { return GAME_SYSTEMS.find(system => system.id === id); }
export function getRuleset(configuration: Pick<CampaignConfiguration, 'systemId' | 'rulesetId'>) {
  return getGameSystem(configuration.systemId)?.rulesets.find(ruleset => ruleset.id === configuration.rulesetId);
}
export function normalizeConfiguration(value: unknown = DEFAULT_CONFIGURATION): CampaignConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid campaign configuration');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !['systemId', 'rulesetId', 'options', 'gmController'].includes(key)) || typeof data.systemId !== 'string' || typeof data.rulesetId !== 'string') throw new Error('Invalid campaign configuration');
  const ruleset = getRuleset({ systemId: data.systemId, rulesetId: data.rulesetId });
  if (!ruleset) throw new Error('Invalid or unsupported game system/ruleset');
  const options = data.options ?? {};
  if (typeof options !== 'object' || options === null || Array.isArray(options)) throw new Error('Invalid ruleset options');
  if (data.gmController !== undefined && data.gmController !== 'ai' && data.gmController !== 'human') throw new Error('Invalid GM controller');
  if (data.gmController === 'ai' && !getGameSystem(data.systemId)?.supportsAiGm) throw new Error('Invalid AI controller for this system');
  return { systemId: data.systemId, rulesetId: data.rulesetId, options: ruleset.normalizeOptions(options as Record<string, unknown>), ...(data.gmController === 'ai' ? { gmController: 'ai' as const } : {}) };
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
