import { describe, expect, it } from 'vitest';
import {
  adversaryTypeName, DUALITY_TABLE_GROUPS, DUALITY_TABLES, fearCheck, readDualityMeaning, readDualityTable,
  resolveFearSpend,
} from './duality-engine';

const faces = Array.from({ length: 12 }, (_, index) => index + 1);

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

describe('Tables', () => {
  it('have twelve non-empty rows in every column and unique ids', () => {
    expect(new Set(DUALITY_TABLES.map(item => item.id)).size).toBe(DUALITY_TABLES.length);
    for (const item of DUALITY_TABLES) for (const column of item.columns) {
      expect(column.entries.length).toBe(12);
      expect(column.entries.every(entry => entry.trim().length > 0)).toBe(true);
    }
  });
  it('read ranges and meaning columns', () => {
    expect(readDualityTable('how-much', 1)).toMatch(/^Far less/);
    expect(readDualityTable('how-much', 12)).toMatch(/^Far more/);
    expect(readDualityTable('tactics', 3)).toBe('Attack the nearest PC');
    expect(readDualityTable('tactics', 4)).toBe('Attack the most wounded PC');
    expect(readDualityMeaning('action', 1, 3)).toBe('Seek');
    expect(readDualityMeaning('action', 1, 4)).toBe('Deceive');
    expect(() => readDualityTable('missing', 1)).toThrow('Invalid table');
  });
  it('prices the Fear Spend rows', () => {
    expect(resolveFearSpend(5)).toMatchObject({ cost: 0, featureCost: true, hardMove: false });
    expect(resolveFearSpend(6)).toMatchObject({ cost: 1, featureCost: false, hardMove: false });
    expect(resolveFearSpend(11)).toMatchObject({ cost: 1, hardMove: true });
  });
});

describe('Adversary tables', () => {
  it('name a Daggerheart adversary type on every row', () => {
    const types = ['Bruiser', 'Horde', 'Leader', 'Minion', 'Ranged', 'Skulk', 'Social', 'Solo', 'Standard', 'Support'];
    expect(new Set(faces.map(adversaryTypeName))).toEqual(new Set(types));
    expect(adversaryTypeName(12)).toBe('Solo');
  });
  it('keep the loop groups in play order', () => {
    expect(DUALITY_TABLE_GROUPS.slice(0, 4).map(group => group.id)).toEqual(['iron', 'start', 'oracle', 'meaning']);
    for (const id of ['soft-move', 'hard-move', 'scene-complication', 'altered-scene', 'event-focus'])
      expect(DUALITY_TABLES.some(table => table.id === id)).toBe(false);
    expect(DUALITY_TABLES.every(item => DUALITY_TABLE_GROUPS.some(group => group.id === item.group))).toBe(true);
  });
});
