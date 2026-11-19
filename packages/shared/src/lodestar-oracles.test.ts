import { describe, expect, it } from 'vitest';
import { LODESTAR_GROUPS, LODESTAR_TABLES, lodestarTable, readLodestarColumn } from './lodestar-oracles';

describe('Lodestar oracles', () => {
  it('has every column covering 1 to 100 once, with text in every row', () => {
    for (const table of LODESTAR_TABLES) {
      for (const column of table.columns) {
        let expected = 1;
        for (const [from, to, text] of column.rows) {
          expect(from, `${table.id}/${column.label}`).toBe(expected);
          expect(to).toBeGreaterThanOrEqual(from);
          expect(text.trim().length).toBeGreaterThan(0);
          expected = to + 1;
        }
        expect(expected, `${table.id}/${column.label} ends at 100`).toBe(101);
      }
    }
  });
  it('keeps the printed sizes of the big word tables', () => {
    const size = (id: string) => lodestarTable(id).columns[0]!.rows.length;
    expect(['action', 'theme', 'character-descriptor', 'ironlander-names-a', 'ironlander-names-b'].map(size)).toEqual([100, 100, 100, 100, 100]);
    expect(lodestarTable('settlement-name').columns).toHaveLength(8);
    expect(lodestarTable('other-names').columns.map(column => column.label)).toEqual(['Giants', 'Varou', 'Trolls']);
  });
  it('uses each table once, in a known group', () => {
    const ids = LODESTAR_TABLES.map(table => table.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const table of LODESTAR_TABLES) expect(LODESTAR_GROUPS.map(group => group.id)).toContain(table.group);
  });
  it('reads rows by roll, and treats 00 as 100', () => {
    const region = lodestarTable('region').columns[0]!;
    expect(readLodestarColumn(region, 1)[2]).toBe('Barrier Islands');
    expect(readLodestarColumn(region, 12)[2]).toBe('Barrier Islands');
    expect(readLodestarColumn(region, 13)[2]).toBe('Ragged Coast');
    expect(readLodestarColumn(region, 100)[2]).toBe('Elsewhere');
    expect(() => readLodestarColumn(region, 0)).toThrow();
    expect(() => readLodestarColumn(region, 101)).toThrow();
    expect(() => lodestarTable('nothing')).toThrow();
  });
  it('joins text that wraps in the book', () => {
    const trouble = lodestarTable('settlement-trouble').columns[0]!;
    expect(trouble.rows.find(row => row[0] === 87)![2]).toBe('Important event threatened');
    const backlash = lodestarTable('mystic-backlash').columns[0]!;
    expect(backlash.rows.find(row => row[0] === 33)![2]).toContain('without memory of how you got there');
  });
});
