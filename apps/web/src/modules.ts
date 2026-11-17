import { getRuleset, type CampaignConfiguration } from '@daggery/shared';
import { DAGGERHEART_UI } from './systems/daggerheart';
import type { SystemUI } from './systems/types';
export type { SystemUI, SystemModule } from './systems/types';
const SYSTEM_UI: Record<string, SystemUI> = { daggerheart: DAGGERHEART_UI };
export function getSystemUI(configuration: CampaignConfiguration) { return Object.hasOwn(SYSTEM_UI, configuration.systemId) ? SYSTEM_UI[configuration.systemId] : undefined; }
export function getModules(configuration: CampaignConfiguration) {
  const ruleset = getRuleset(configuration);
  return getSystemUI(configuration)?.modules.filter(module => ruleset?.features.includes(module.feature)).map(module => ({ ...module,
    primary: module.primaryRulesets ? module.primaryRulesets.includes(configuration.rulesetId) : module.primary,
  })) ?? [];
}
