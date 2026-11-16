import type { IronMoveGroup, IronOutcome } from '@daggery/shared';
import type { IconName } from '../../components/Icon';

/**
 * How the moves of Duality GME lead into the tables: what each move rolls, and
 * what to reach for next after a strong hit, weak hit or miss. Every step here
 * comes from the move text in the manual.
 */
export type Step =
  | { kind: 'table'; table: string; label?: string; column?: number }
  | { kind: 'oracle' }
  | { kind: 'meaning'; first: 'action' | 'descriptor' }
  | { kind: 'fear-check' };

export interface MoveFlow {
  /** How the move is resolved on this page. */
  resolve: 'action' | 'progress' | 'none';
  /** Tables and tools you use while making the move, whatever the outcome. */
  tools?: readonly Step[];
  strong?: readonly Step[];
  weak?: readonly Step[];
  miss?: readonly Step[];
}

const price: Step = { kind: 'table', table: 'iron-price', label: 'Pay the Price' };
const oracle: Step = { kind: 'oracle' };
const happens: Step = { kind: 'meaning', first: 'action' };
const looks: Step = { kind: 'meaning', first: 'descriptor' };
const table = (id: string, label?: string): Step => ({ kind: 'table', table: id, label });

export const MOVE_FLOWS: Record<string, MoveFlow> = {
  'begin-session': { resolve: 'none', tools: [table('iron-vignette', 'Vignette'), table('rumor', 'Rumors and Leads')] },
  'set-flag': { resolve: 'none' },
  'change-fate': { resolve: 'none', tools: [oracle, happens] },
  'take-break': { resolve: 'none' },
  'end-session': { resolve: 'none' },

  'swear-vow': { resolve: 'action', tools: [table('plot-hook', 'Plot hook'), table('plot-stakes', 'Reward and twist')], weak: [oracle, happens], miss: [price] },
  milestone: { resolve: 'none' },
  'fulfill-vow': { resolve: 'progress', weak: [happens], miss: [table('plot-stakes', 'The twist')] },
  'forsake-vow': { resolve: 'none' },

  'face-danger': { resolve: 'action', miss: [price] },
  'secure-advantage': { resolve: 'action', miss: [price] },
  'gather-information': { resolve: 'action', tools: [table('rumor', 'Rumors and Leads')], weak: [oracle, happens], miss: [price] },
  compel: { resolve: 'action', tools: [table('npc-manner', 'Attitude')], weak: [happens], miss: [price] },
  'make-camp': { resolve: 'none', tools: [table('rest', 'Rest and Camp'), table('iron-vignette', 'Vignette')] },

  'undertake-expedition': { resolve: 'action', tools: [table('wilds', 'Wilds'), table('journey', 'Journeys')], strong: [table('iron-waypoint', 'Waypoint')], weak: [table('iron-waypoint', 'Waypoint'), price], miss: [price] },
  'explore-waypoint': { resolve: 'action', tools: [table('iron-waypoint', 'Waypoint')], strong: [table('iron-opportunity', 'Opportunity'), table('iron-discovery', 'Discovery (critical)')], weak: [looks, oracle], miss: [price, { kind: 'fear-check' }, table('iron-chaos', 'Confront Chaos')] },
  'make-discovery': { resolve: 'none', tools: [table('iron-discovery', 'Make a Discovery')] },
  'confront-chaos': { resolve: 'none', tools: [table('iron-chaos', 'Confront Chaos')] },
  'finish-expedition': { resolve: 'progress', tools: [table('settlement', 'Settlement'), table('site', 'Site Crawler')], weak: [looks], miss: [price] },

  'make-connection': { resolve: 'action', tools: [table('names', 'Name'), table('npc-identity', 'Role and Motive'), table('npc-manner', 'Attitude')], weak: [happens], miss: [price] },
  'develop-relationship': { resolve: 'none' },
  'forge-bond': { resolve: 'progress', weak: [happens], miss: [price] },

  'begin-scene': { resolve: 'none', tools: [oracle] },
  'scene-action': { resolve: 'action', miss: [price] },
  'finish-scene': { resolve: 'progress', miss: [price] },

  'enter-fray': { resolve: 'action', tools: [table('adversary-creature', 'Creature'), table('adversary-type', 'Adversary type')], miss: [price] },
  battle: { resolve: 'action', weak: [price], miss: [price] },
  'gm-turn': { resolve: 'none', tools: [{ kind: 'fear-check' }, table('tactics', 'Tactics (free)'), table('fear-spend', 'Fear Spend')] },

  'ask-oracle': { resolve: 'none', tools: [oracle, happens, looks, table('how-much', 'How much?')] },
  'pay-price': { resolve: 'none', tools: [price] },
};

/** Where you are in the story, and the move you most often reach for there. */
export const MOVE_GROUP_META: Record<IronMoveGroup, { icon: IconName; blurb: string }> = {
  session: { icon: 'sun', blurb: 'Open and close the table.' },
  quest: { icon: 'shield', blurb: 'Oaths and milestones.' },
  adventure: { icon: 'compass', blurb: 'Act under pressure.' },
  exploration: { icon: 'map', blurb: 'Expeditions and waypoints.' },
  connection: { icon: 'users', blurb: 'People who matter.' },
  scene: { icon: 'target', blurb: 'Chases, heists, debates.' },
  combat: { icon: 'combat', blurb: 'Fights and the GM turn.' },
  fate: { icon: 'spark', blurb: 'Oracle and the price.' },
};

/** The five Difficulties the engine uses, with the reason you would pick each. */
export const DIFFICULTIES = [
  { value: 10, label: 'Easy', hint: 'A concrete fact makes it simple, or a Minor rank.' },
  { value: 13, label: 'Base', hint: 'No obstacle, or a Serious rank.' },
  { value: 15, label: '1 obstacle', hint: 'Resistance, Demand or Conditions; or a Grave rank.' },
  { value: 18, label: '2 obstacles', hint: 'Two obstacles, or a Dire rank.' },
  { value: 20, label: '3 obstacles', hint: 'All three obstacles, or a Legendary rank.' },
] as const;

export const OUTCOME_ORDER: readonly IronOutcome[] = ['strong', 'weak', 'miss'];
