/**
 * Conditions on the character sheet: Daggerheart's three conditions and Ironsworn's eight Debilities.
 *
 * Daggerheart conditions describe your position in the fiction (Hidden, Restrained, Vulnerable).
 * Ironsworn Debilities describe your state, and each one also lowers the most Momentum you can hold
 * (see duality-momentum.ts). They share one list on the sheet so a player reads them in one place.
 */
import { DEBILITIES, type DebilityGroup } from './duality-momentum';

export type ConditionSource = 'daggerheart' | 'ironsworn';
export type ConditionGroup = 'position' | DebilityGroup;

export interface SheetCondition {
  id: string;
  label: string;
  source: ConditionSource;
  group: ConditionGroup;
  /** A short rule, in plain words. */
  text: string;
  /** Marking it lowers the most Momentum you can hold. */
  momentum: boolean;
}

/** From the Daggerheart rules: the three conditions. */
export const DAGGERHEART_CONDITIONS: readonly SheetCondition[] = [
  { id: 'hidden', label: 'Hidden', source: 'daggerheart', group: 'position', momentum: false,
    text: 'You are out of sight and no enemy knows where you are. Rolls against you have disadvantage. You stop being Hidden when an enemy sees you or you attack.' },
  { id: 'restrained', label: 'Restrained', source: 'daggerheart', group: 'position', momentum: false,
    text: 'You cannot move. You can still act from where you are.' },
  { id: 'vulnerable', label: 'Vulnerable', source: 'daggerheart', group: 'position', momentum: false,
    text: 'All rolls that target you have advantage.' },
];

export const IRONSWORN_CONDITIONS: readonly SheetCondition[] = DEBILITIES.map(item => ({
  id: item.id, label: item.label, source: 'ironsworn' as const, group: item.group, text: item.hint, momentum: true,
}));

export const SHEET_CONDITIONS: readonly SheetCondition[] = [...DAGGERHEART_CONDITIONS, ...IRONSWORN_CONDITIONS];
const IDS: ReadonlySet<string> = new Set(SHEET_CONDITIONS.map(item => item.id));
const DEBILITY_IDS: ReadonlySet<string> = new Set(DEBILITIES.map(item => item.id));

/** Keeps only known conditions, once each. A bad or old sheet reads as no conditions. */
export const parseConditions = (raw: unknown): string[] =>
  Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === 'string' && IDS.has(id)))] : [];

/** The Ironsworn Debilities among a list of conditions. They set the Momentum maximum. */
export const debilitiesOf = (conditions: readonly string[]): string[] => conditions.filter(id => DEBILITY_IDS.has(id));

/** Marks or clears one condition and returns the new list. */
export const toggleCondition = (conditions: readonly string[], id: string, marked: boolean): string[] => {
  const rest = parseConditions(conditions).filter(item => item !== id);
  return marked && IDS.has(id) ? [...rest, id] : rest;
};

/** Replaces the Debilities in a list and keeps the Daggerheart conditions as they are. */
export const withDebilities = (conditions: readonly string[], debilities: readonly string[]): string[] =>
  parseConditions([...conditions.filter(id => !DEBILITY_IDS.has(id)), ...debilities]);
