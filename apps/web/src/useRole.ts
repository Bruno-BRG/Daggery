import { getActiveCampaign } from './campaign-context';
export type Role = 'GM' | 'Player';
/** The role is granted by the server and cannot be changed locally. */
export function useRole(): [Role, (role: Role) => void] {
  return [getActiveCampaign().role === 'gm' ? 'GM' : 'Player', () => {}];
}
