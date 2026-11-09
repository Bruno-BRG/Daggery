import { hasFeature, type Advantage, type SoloState } from '@daggery/shared';
import { getActiveCampaign } from '../campaign-context';
import { useDoc } from '../sync/store';
import { api } from '../api';

/** Daggerheart sheet integration; oracle/content rolls never call this hook's consume function. */
export function useSoloAssistance(heroId: string) {
  const [state] = useDoc<SoloState>('solo', 'state');
  const campaign = getActiveCampaign();
  const prepared = hasFeature(campaign.configuration, 'daggerheart.solo') && campaign.configuration.options.partyMode === 'companion' && state?.beat.assistedHeroId === heroId && !state.beat.assistConsumed;
  return {
    prepared,
    consume: async (base: Advantage | undefined): Promise<Advantage | undefined> => {
      if (!prepared || !state) return base;
      await api(`/api/campaigns/${encodeURIComponent(campaign.id)}/solo/command`, 'POST', { command: 'consume-assist', revision: state.revision, heroId });
      return base === 'disadvantage' ? undefined : 'advantage';
    },
  };
}
