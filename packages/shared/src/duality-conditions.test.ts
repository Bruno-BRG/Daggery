import { describe, expect, it } from 'vitest';
import { debilitiesOf, parseConditions, SHEET_CONDITIONS, toggleCondition, withDebilities } from './duality-conditions';

describe('Sheet conditions', () => {
  it('lists the three Daggerheart conditions and the eight Debilities', () => {
    expect(SHEET_CONDITIONS.filter(item => item.source === 'daggerheart').map(item => item.id)).toEqual(['hidden', 'restrained', 'vulnerable']);
    expect(SHEET_CONDITIONS.filter(item => item.momentum)).toHaveLength(8);
  });
  it('drops unknown and repeated ids', () => {
    expect(parseConditions(['hidden', 'hidden', 'bogus', 4])).toEqual(['hidden']);
    expect(parseConditions('x')).toEqual([]);
  });
  it('marks and clears one condition', () => {
    expect(toggleCondition([], 'wounded', true)).toEqual(['wounded']);
    expect(toggleCondition(['wounded', 'hidden'], 'wounded', false)).toEqual(['hidden']);
  });
  it('splits Debilities from Daggerheart conditions', () => {
    expect(debilitiesOf(['hidden', 'wounded', 'cursed'])).toEqual(['wounded', 'cursed']);
    expect(withDebilities(['hidden', 'wounded'], ['shaken'])).toEqual(['hidden', 'shaken']);
  });
});
