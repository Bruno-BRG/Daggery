import type { DiceRoll, DualityResult } from './dice';

export const TRAIT_NAMES = [
  'agility',
  'strength',
  'finesse',
  'instinct',
  'presence',
  'knowledge',
] as const;

export type TraitName = (typeof TRAIT_NAMES)[number];
export type Traits = Record<TraitName, number>;

export interface Pool {
  current: number;
  max: number;
}

export interface Character {
  id: string;
  name: string;
  playerName?: string;
  ancestry?: string;
  community?: string;
  className?: string;
  subclass?: string;
  level: number;
  traits: Traits;
  evasion: number;
  armorScore: number;
  hitPoints: Pool;
  stress: Pool;
  /** Hope resource. Daggerheart caps this at 6. */
  hope: number;
}

export type TokenKind = 'character' | 'adversary' | 'npc' | 'marker';

export interface Token {
  id: string;
  name: string;
  kind: TokenKind;
  /** Id of the Character or Adversary this token stands for, if any. */
  refId?: string;
  sceneId?: string;
  x: number;
  y: number;
  /** Footprint in grid cells. */
  size: number;
  hidden: boolean;
}

/** Stub until packages/content defines the full adversary stat block. */
export interface Adversary {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4;
  type: string;
  difficulty: number;
  hitPoints: number;
  stress: number;
}

export type RollPayload = (
  | { kind: 'duality'; result: DualityResult }
  | { kind: 'dice'; result: DiceRoll }
) & {
  /** Correlates a local animation with its broadcast, independently of the authenticated author. */
  clientRollId?: string;
};

/** A roll as stored in the shared log. The server assigns id and at. */
export type RollLogEntry = RollPayload & {
  id: number;
  at: string;
  author: string;
};

/** Client to server: submit a roll for the shared log. */
export type ClientRollMessage = { type: 'roll'; author: string } & RollPayload;

/** Server to client. */
export type ServerMessage =
  | { type: 'hello'; rolls: RollLogEntry[] }
  | { type: 'roll'; entry: RollLogEntry }
  | { type: 'error'; message: string };
