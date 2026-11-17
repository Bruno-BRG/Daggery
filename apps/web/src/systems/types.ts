import type { ComponentType, LazyExoticComponent } from 'react';
import type { CampaignConfiguration, ClientRollMessage } from '@daggery/shared';
import type { IconName } from '../components/Icon';
export interface SystemModule {
  id: string; feature: string; label: string; icon: IconName; description: string;
  gmOnly?: boolean; primary?: boolean; primaryRulesets?: readonly string[];
  component: LazyExoticComponent<ComponentType<{ author: string }>>;
}
export interface SystemUI {
  modules: SystemModule[];
  optionsEditor?: ComponentType<{ value: CampaignConfiguration; onChange: (value: CampaignConfiguration) => void }>;
  diceTray?: ComponentType<{ author: string; onRolled?: (message: ClientRollMessage) => void }>;
  diceOverlay?: ComponentType;
  /** A side panel shown beside every page when the campaign has its feature, such as the solo screen. */
  companion?: {
    feature: string; label: string; icon: IconName; gmOnly?: boolean;
    component: LazyExoticComponent<ComponentType<{ open: boolean; onClose: () => void }>>;
  };
}
