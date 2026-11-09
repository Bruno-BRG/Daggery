import { getActiveCampaign } from './campaign-context';
import { savePreference } from './storage';

export function pendingTableCharacterKey() { return `daggery:table-character:${getActiveCampaign().id}`; }
export function bringCharacterToTable(sheetId: string) {
  if (getActiveCampaign().role === 'gm') savePreference(pendingTableCharacterKey(), sheetId);
  window.dispatchEvent(new CustomEvent('daggery:navigate', { detail: 'map' }));
}
