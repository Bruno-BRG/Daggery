import { describe, expect, it } from 'vitest';
import {
  DUALITY_LIKELIHOODS, DUALITY_TABLES, dualityAnswerLabel, eventFocusList, fearCheck, readDualityMeaning, readDualityTable,
  resolveDualityMove, resolveDualityOracle, resolveDualityScene, resolveFearSpend,
} from './duality-engine';

const faces = Array.from({ length: 12 }, (_, index) => index + 1);
const pairs = faces.flatMap(hope => faces.map(fear => [hope, fear] as const));

describe('Fear Check', () => {
  it('passes at or under current Fear and never at 0', () => {
    expect(fearCheck(6, 6)).toBe(true);
    expect(fearCheck(7, 6)).toBe(false);
    expect(faces.some(roll => fearCheck(roll, 0))).toBe(false);
    expect(faces.every(roll => fearCheck(roll, 12))).toBe(true);
    expect(() => fearCheck(13, 3)).toThrow('Invalid');
    expect(() => fearCheck(3, 13)).toThrow('Invalid');
  });
});

describe('Oracle', () => {
  it('matches the printed chances over all 144 pairs', () => {
    const yes = (id: string) => pairs.filter(([hope, fear]) => resolveDualityOracle(hope, fear, id).yes).length;
    expect(DUALITY_LIKELIHOODS.map(item => yes(item.id))).toEqual([129, 108, 78, 45, 21]);
    for (const item of DUALITY_LIKELIHOODS) expect(`${Math.round(yes(item.id) / 1.44)}%`).toBe(item.chance);
  });
  it('twists when the dice are 4 or more apart, evenly for each die', () => {
    const answers = pairs.map(([hope, fear]) => resolveDualityOracle(hope, fear, 'even'));
    expect(answers.filter(answer => answer.twist === 'favor').length).toBe(36);
    expect(answers.filter(answer => answer.twist === 'against').length).toBe(36);
    expect(answers.filter(answer => answer.randomEvent).length).toBe(12);
    expect(resolveDualityOracle(9, 5, 'even').twist).toBe('favor');
    expect(resolveDualityOracle(8, 5, 'even').twist).toBeNull();
  });
  it('labels the four twisted answers', () => {
    expect(dualityAnswerLabel(resolveDualityOracle(10, 4, 'even'))).toBe('Yes, and…');
    expect(dualityAnswerLabel(resolveDualityOracle(4, 10, 'even'))).toBe('Yes, but…');
    expect(dualityAnswerLabel(resolveDualityOracle(6, 2, 'even'))).toBe('No, but…');
    expect(dualityAnswerLabel(resolveDualityOracle(2, 6, 'even'))).toBe('No, and…');
    expect(dualityAnswerLabel(resolveDualityOracle(7, 7, 'even'))).toBe('Yes');
    expect(() => resolveDualityOracle(1, 1, 'maybe')).toThrow('Invalid likelihood');
  });
});

describe('Scene setup and GM Moves', () => {
  it('alters on an odd pass and interrupts on an even pass', () => {
    expect(resolveDualityScene(3, 6)).toBe('altered');
    expect(resolveDualityScene(4, 6)).toBe('interrupted');
    expect(resolveDualityScene(7, 6)).toBe('expected');
  });
  it('only failure with Fear and stalls make a Fear Check', () => {
    expect(resolveDualityMove('success-fear', undefined, 12)).toBe('soft');
    expect(resolveDualityMove('failure-hope', undefined, 12)).toBe('soft');
    expect(resolveDualityMove('failure-fear', 5, 5)).toBe('hard');
    expect(resolveDualityMove('failure-fear', 6, 5)).toBe('soft');
    expect(resolveDualityMove('stall', 5, 5)).toBe('hard');
    expect(resolveDualityMove('stall', 6, 5)).toBe('none');
    expect(() => resolveDualityMove('critical', 1, 1)).toThrow('Invalid move trigger');
  });
});

describe('Tables', () => {
  it('have twelve non-empty rows in every column and unique ids', () => {
    expect(new Set(DUALITY_TABLES.map(item => item.id)).size).toBe(DUALITY_TABLES.length);
    for (const item of DUALITY_TABLES) for (const column of item.columns) {
      expect(column.entries.length).toBe(12);
      expect(column.entries.every(entry => entry.trim().length > 0)).toBe(true);
    }
  });
  it('read ranges, meaning columns and the event focus lists', () => {
    expect(readDualityTable('how-much', 1)).toMatch(/^Far less/);
    expect(readDualityTable('how-much', 12)).toMatch(/^Far more/);
    expect(readDualityTable('tactics', 3)).toBe('Attack the nearest PC');
    expect(readDualityTable('tactics', 4)).toBe('Attack the most wounded PC');
    expect(readDualityMeaning('action', 1, 3)).toBe('Seek');
    expect(readDualityMeaning('action', 1, 4)).toBe('Deceive');
    expect(faces.map(eventFocusList)).toEqual([null, null, null, 'characters', 'characters', 'characters', 'threads', 'threads', 'threads', null, null, null]);
    expect(() => readDualityTable('missing', 1)).toThrow('Invalid table');
  });
  it('prices the Fear Spend rows', () => {
    expect(resolveFearSpend(5)).toMatchObject({ cost: 0, featureCost: true, hardMove: false });
    expect(resolveFearSpend(6)).toMatchObject({ cost: 1, featureCost: false, hardMove: false });
    expect(resolveFearSpend(11)).toMatchObject({ cost: 1, hardMove: true });
  });
});
