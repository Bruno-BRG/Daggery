import { NO_CONDITIONS, sourceOf, type AdversaryDoc } from '../combat/model';
import type { MapToken } from './model';

const coreConditions = ['Hidden', 'Restrained', 'Vulnerable'];
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));

export function encounterToken(token: MapToken, encounter: AdversaryDoc | undefined): MapToken {
  const source = encounter?.kind === 'adversary' ? sourceOf(encounter.catalogId) : undefined;
  if (!encounter || !source) return token;
  const max = encounter.groupSize ?? source.hp;
  return {
    ...token,
    hp: { max, current: clamp(max - (encounter.groupSize !== null ? encounter.defeated : encounter.hpMarked), max) },
    stress: source.stress
      ? { max: source.stress, current: clamp(source.stress - encounter.stressMarked, source.stress) }
      : undefined,
    conditions: [
      ...token.conditions.filter((c) => !coreConditions.includes(c)),
      ...coreConditions.filter((c) => encounter.conditions[c.toLowerCase() as keyof typeof NO_CONDITIONS]),
    ],
  };
}

export function patchEncounter(encounter: AdversaryDoc, patch: Partial<MapToken>): AdversaryDoc {
  const source = sourceOf(encounter.catalogId);
  if (!source) return encounter;
  const max = encounter.groupSize ?? source.hp;
  return {
    ...encounter,
    ...(patch.hp
      ? encounter.groupSize !== null
        ? { defeated: max - clamp(patch.hp.current, max) }
        : { hpMarked: max - clamp(patch.hp.current, max) }
      : {}),
    ...(patch.stress ? { stressMarked: (source.stress ?? 0) - clamp(patch.stress.current, source.stress ?? 0) } : {}),
    ...(patch.conditions
      ? {
          conditions: {
            hidden: patch.conditions.includes('Hidden'),
            restrained: patch.conditions.includes('Restrained'),
            vulnerable: patch.conditions.includes('Vulnerable'),
          },
        }
      : {}),
  };
}
