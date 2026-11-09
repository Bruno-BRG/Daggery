import type { CampaignConfiguration } from '@daggery/shared';
export interface ActiveCampaign { id: string; name: string; role: 'gm' | 'player'; configuration: CampaignConfiguration; description?: string }
let current: ActiveCampaign | null = null;
export function setActiveCampaign(campaign: ActiveCampaign | null): void { current = campaign; }
export function getActiveCampaign(): ActiveCampaign {
  if (!current) throw new Error('No campaign selected');
  return current;
}
export function gameSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws?campaign=${encodeURIComponent(getActiveCampaign().id)}`;
}
export function reportSyncError(message: string): void {
  window.dispatchEvent(new CustomEvent('daggery:sync-error', { detail: message }));
}
