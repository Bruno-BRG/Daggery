import type { IronMoveGroup, IronOutcome } from '@daggery/shared';
import type { IconName } from '../../components/Icon';

/**
 * How the moves of Duality GME lead into the tables: what each move rolls, and
 * what to reach for next after a strong hit, weak hit or miss. Every step here
 * comes from the move text in the manual.
 */
export type Step =
  | { kind: 'table'; table: string; label?: string; column?: number }
  | { kind: 'lodestar'; table: string; label?: string }
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
const lodestar = (id: string, label?: string): Step => ({ kind: 'lodestar', table: id, label });

export const MOVE_FLOWS: Record<string, MoveFlow> = {
  'begin-session': { resolve: 'none', tools: [table('iron-vignette', 'Vignette'), table('rumor', 'Rumors and Leads')] },
  'set-flag': { resolve: 'none' },
  'change-fate': { resolve: 'none', tools: [oracle, happens] },
  'take-break': { resolve: 'none' },
  'end-session': { resolve: 'none' },

  // Quest moves
  'swear-vow': { resolve: 'action', tools: [table('plot-hook', 'Plot hook'), table('plot-stakes', 'Reward and twist'), lodestar('settlement-trouble', 'Settlement Trouble'), lodestar('character-goal', 'Character Goal')], weak: [oracle, happens], miss: [price] },
  milestone: { resolve: 'none' },
  'fulfill-vow': { resolve: 'progress', weak: [happens], miss: [lodestar('major-plot-twist', 'Major Plot Twist'), table('plot-stakes', 'The twist')] },
  'forsake-vow': { resolve: 'none' },
  advance: { resolve: 'none' },

  // Adventure moves
  'face-danger': { resolve: 'action', miss: [price] },
  'secure-advantage': { resolve: 'action', miss: [price] },
  'gather-information': { resolve: 'action', tools: [table('rumor', 'Rumors and Leads')], weak: [oracle, happens], miss: [price] },
  heal: { resolve: 'action', miss: [price] },
  resupply: { resolve: 'action', miss: [price] },
  'make-camp': { resolve: 'action', tools: [table('rest', 'Rest and Camp'), table('iron-vignette', 'Vignette')], miss: [price] },
  'undertake-expedition': { resolve: 'action', tools: [table('wilds', 'Wilds'), table('journey', 'Journeys'), lodestar('region', 'Region'), lodestar('location', 'Location')], strong: [table('iron-waypoint', 'Waypoint')], weak: [table('iron-waypoint', 'Waypoint')], miss: [price] },
  'finish-expedition': { resolve: 'progress', tools: [table('settlement', 'Settlement'), table('site', 'Site Crawler'), lodestar('location-descriptor', 'Location Descriptor')], weak: [looks, oracle] },

  // Exploration extras
  'explore-waypoint': { resolve: 'action', tools: [table('iron-waypoint', 'Waypoint')], strong: [table('iron-opportunity', 'Opportunity'), table('iron-discovery', 'Discovery (critical)')], weak: [looks, oracle], miss: [price, { kind: 'fear-check' }, table('iron-chaos', 'Confront Chaos')] },
  'make-discovery': { resolve: 'none', tools: [table('iron-discovery', 'Make a Discovery')] },
  'confront-chaos': { resolve: 'none', tools: [table('iron-chaos', 'Confront Chaos')] },

  // Relationship moves
  compel: { resolve: 'action', tools: [table('npc-manner', 'Attitude'), lodestar('character-disposition', 'Character Disposition')], weak: [happens], miss: [price] },
  sojourn: { resolve: 'action', tools: [lodestar('settlement-trouble', 'Settlement Trouble')], miss: [price] },
  'draw-circle': { resolve: 'action', miss: [price] },
  'make-connection': { resolve: 'action', tools: [table('names', 'Name'), lodestar('ironlander-names-a', 'Ironlander Names'), table('npc-identity', 'Role and Motive'), lodestar('character-role', 'Character Role'), lodestar('character-descriptor', 'Character Descriptor')], weak: [happens], miss: [price] },
  'forge-bond': { resolve: 'action', weak: [happens], miss: [price] },
  'test-bond': { resolve: 'action', weak: [happens], miss: [price] },
  'aid-ally': { resolve: 'none' },
  'write-epilogue': { resolve: 'progress', weak: [oracle, happens] },

  // Scene challenge
  'begin-scene': { resolve: 'none', tools: [oracle] },
  'scene-action': { resolve: 'action', miss: [price] },
  'finish-scene': { resolve: 'progress', miss: [price] },

  // Combat moves
  'enter-fray': { resolve: 'action', tools: [lodestar('challenge-rank', 'Foe rank'), table('adversary-creature', 'Creature'), table('adversary-type', 'Adversary type')], miss: [price] },
  strike: { resolve: 'action', miss: [price] },
  clash: { resolve: 'action', weak: [price], miss: [price] },
  'turn-tide': { resolve: 'none' },
  'end-fight': { resolve: 'progress', weak: [lodestar('major-plot-twist', 'A new danger'), price], miss: [price] },
  battle: { resolve: 'action', weak: [price], miss: [price] },
  'gm-turn': { resolve: 'none', tools: [{ kind: 'fear-check' }, table('tactics', 'Tactics (free)'), table('fear-spend', 'Fear Spend'), lodestar('combat-action', 'Combat Action')] },

  // Suffer moves
  'endure-harm': { resolve: 'action', miss: [lodestar('endure-harm', 'Endure Harm table')] },
  'face-death': { resolve: 'action' },
  'companion-endure-harm': { resolve: 'action' },
  'endure-stress': { resolve: 'action', miss: [lodestar('endure-stress', 'Endure Stress table')] },
  'face-desolation': { resolve: 'action' },
  'out-of-supply': { resolve: 'none' },
  'face-setback': { resolve: 'none', tools: [oracle] },

  // Fate moves
  'ask-oracle': { resolve: 'none', tools: [oracle, happens, looks, table('how-much', 'How much?'), lodestar('action', 'Action (d100)'), lodestar('theme', 'Theme (d100)')] },
  'pay-price': { resolve: 'none', tools: [price, lodestar('pay-the-price', 'Pay the Price (d100)'), lodestar('mystic-backlash', 'Mystic Backlash')] },
};

/** Where you are in the story, and the move you most often reach for there. */
export const MOVE_GROUP_META: Record<IronMoveGroup, { icon: IconName; blurb: string }> = {
  session: { icon: 'sun', blurb: 'Open and close the table.' },
  quest: { icon: 'shield', blurb: 'Vows and milestones.' },
  adventure: { icon: 'compass', blurb: 'Act under pressure.' },
  exploration: { icon: 'map', blurb: 'Expeditions and waypoints.' },
  connection: { icon: 'users', blurb: 'Bonds, duels and aid.' },
  scene: { icon: 'target', blurb: 'Chases, heists, debates.' },
  combat: { icon: 'combat', blurb: 'Initiative, harm and the GM turn.' },
  suffer: { icon: 'heart', blurb: 'Harm, stress, supply and setbacks.' },
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
