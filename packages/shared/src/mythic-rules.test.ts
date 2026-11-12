import { describe, expect, it } from 'vitest';
import {
  EVENT_FOCUS_TABLE,
  PREPARED_EVENT_FOCUS_TABLE,
  adjustChaos,
  advanceThreadTrack,
  discoveryOdds,
  fateChartCell,
  isRandomEventRoll,
  listSectionDie,
  newThreadTrack,
  resolveEventFocus,
  resolveFateChart,
  resolveFateCheck,
  resolveListRoll,
  resolveSceneAdjustments,
  resolveSceneTest,
  resolveThreadDiscovery,
  type MythicAnswer,
  type MythicList,
} from './mythic-rules';

/** A line count record with every List populated, unless overridden. */
const lists = (patch: Partial<Record<MythicList, number>> = {}): Record<MythicList, number> => ({
  threads: 0,
  characters: 0,
  features: 0,
  ...patch,
});
const populated = { threads: 3, characters: 3, features: 3 };

type Cell = [number, number, number];

// Rulebook cells as [exceptional yes at or under, yes at or under, exceptional no at or over].
describe('fateChartCell', () => {
  it('reads the standard chart at chaos 5', () => {
    const cases: [string, Cell][] = [
      ['certain', [18, 90, 99]],
      ['nearly-certain', [17, 85, 98]],
      ['very-likely', [15, 75, 96]],
      ['likely', [13, 65, 94]],
      ['fifty-fifty', [10, 50, 91]],
      ['unlikely', [7, 35, 88]],
      ['very-unlikely', [5, 25, 86]],
      ['nearly-impossible', [3, 15, 84]],
      ['impossible', [2, 10, 83]],
    ];
    for (const [odds, [exceptionalYes, yes, exceptionalNo]] of cases) {
      expect(fateChartCell(odds, 5, 'standard'), odds).toEqual({
        exceptionalYes,
        yes,
        exceptionalNo,
      });
    }
  });

  it('reads the standard chart at chaos 1', () => {
    const cases: [string, Cell][] = [
      ['certain', [10, 50, 91]],
      ['fifty-fifty', [2, 10, 83]],
      ['unlikely', [1, 5, 82]],
      ['very-unlikely', [0, 1, 81]],
      ['impossible', [0, 1, 81]],
    ];
    for (const [odds, [exceptionalYes, yes, exceptionalNo]] of cases) {
      expect(fateChartCell(odds, 1, 'standard'), odds).toEqual({
        exceptionalYes,
        yes,
        exceptionalNo,
      });
    }
  });

  it('reads the standard chart at chaos 9', () => {
    const cases: [string, Cell][] = [
      ['certain', [20, 99, 101]],
      ['very-likely', [20, 99, 101]],
      ['likely', [19, 95, 100]],
      ['fifty-fifty', [18, 90, 99]],
      ['impossible', [10, 50, 91]],
    ];
    for (const [odds, [exceptionalYes, yes, exceptionalNo]] of cases) {
      expect(fateChartCell(odds, 9, 'standard'), odds).toEqual({
        exceptionalYes,
        yes,
        exceptionalNo,
      });
    }
  });

  it('reads the remaining standard chaos columns', () => {
    const cases: [string, number, Cell][] = [
      ['impossible', 3, [0, 1, 81]],
      ['nearly-impossible', 3, [1, 5, 82]],
      ['impossible', 4, [1, 5, 82]],
      ['certain', 6, [19, 95, 100]],
      ['certain', 7, [20, 99, 101]],
      ['nearly-certain', 7, [19, 95, 100]],
    ];
    for (const [odds, chaos, [exceptionalYes, yes, exceptionalNo]] of cases) {
      expect(fateChartCell(odds, chaos, 'standard'), `${odds} @ chaos ${chaos}`).toEqual({
        exceptionalYes,
        yes,
        exceptionalNo,
      });
    }
  });

  it('treats the legacy 50/50 alias as fifty-fifty and rejects unknown odds', () => {
    expect(fateChartCell('50-50-or-unknown', 5, 'standard')).toEqual(
      fateChartCell('fifty-fifty', 5, 'standard'),
    );
    expect(() => fateChartCell('not-an-odds', 5, 'standard')).toThrow();
  });

  it('reads the mid-chaos fifty-fifty row', () => {
    const row: Cell[] = [
      [5, 25, 86],
      [7, 35, 88],
      [7, 35, 88],
      [10, 50, 91],
      [10, 50, 91],
      [10, 50, 91],
      [13, 65, 94],
      [13, 65, 94],
      [15, 75, 96],
    ];
    for (let chaos = 1; chaos <= 9; chaos++) {
      const [exceptionalYes, yes, exceptionalNo] = row[chaos - 1]!;
      expect(fateChartCell('fifty-fifty', chaos, 'mid'), `chaos ${chaos}`).toEqual({
        exceptionalYes,
        yes,
        exceptionalNo,
      });
    }
  });

  it('reads the mid-chaos edge cells', () => {
    expect(fateChartCell('certain', 9, 'mid')).toEqual({ exceptionalYes: 20, yes: 99, exceptionalNo: 101 });
    expect(fateChartCell('impossible', 1, 'mid')).toEqual({ exceptionalYes: 0, yes: 1, exceptionalNo: 81 });
  });

  it('reads the low-chaos fifty-fifty row', () => {
    const row: Cell[] = [
      [7, 35, 88],
      [7, 35, 88],
      [10, 50, 91],
      [10, 50, 91],
      [10, 50, 91],
      [10, 50, 91],
      [10, 50, 91],
      [13, 65, 94],
      [13, 65, 94],
    ];
    for (let chaos = 1; chaos <= 9; chaos++) {
      const [exceptionalYes, yes, exceptionalNo] = row[chaos - 1]!;
      expect(fateChartCell('fifty-fifty', chaos, 'low'), `chaos ${chaos}`).toEqual({
        exceptionalYes,
        yes,
        exceptionalNo,
      });
    }
  });

  it('reads the low-chaos edge cells', () => {
    expect(fateChartCell('certain', 8, 'low')).toEqual({ exceptionalYes: 19, yes: 95, exceptionalNo: 100 });
    expect(fateChartCell('impossible', 2, 'low')).toEqual({ exceptionalYes: 1, yes: 5, exceptionalNo: 82 });
  });

  it('gives every chaos value the chaos-5 standard cell with no chaos', () => {
    const fiftyFifty = fateChartCell('fifty-fifty', 5, 'standard');
    const certain = fateChartCell('certain', 5, 'standard');
    for (let chaos = 1; chaos <= 9; chaos++) {
      expect(fateChartCell('fifty-fifty', chaos, 'none'), `chaos ${chaos}`).toEqual(fiftyFifty);
      expect(fateChartCell('certain', chaos, 'none'), `chaos ${chaos}`).toEqual(certain);
    }
  });
});

describe('resolveFateChart', () => {
  it('maps a roll onto the standard fifty-fifty cell at chaos 5', () => {
    const cases: [number, MythicAnswer][] = [
      [10, 'exceptionalYes'],
      [11, 'yes'],
      [50, 'yes'],
      [51, 'no'],
      [90, 'no'],
      [91, 'exceptionalNo'],
      [100, 'exceptionalNo'],
    ];
    for (const [roll, answer] of cases) {
      expect(resolveFateChart(roll, 'fifty-fifty', 5).answer, `roll ${roll}`).toBe(answer);
    }
  });

  it('cannot roll an exceptional yes or no that the cell forbids', () => {
    expect(resolveFateChart(100, 'certain', 9).answer).toBe('no');
    expect(resolveFateChart(99, 'certain', 9).answer).toBe('yes');
    expect(resolveFateChart(1, 'very-unlikely', 1).answer).toBe('yes');
    expect(resolveFateChart(2, 'very-unlikely', 1).answer).toBe('no');
    expect(resolveFateChart(81, 'very-unlikely', 1).answer).toBe('exceptionalNo');
  });
});

describe('isRandomEventRoll', () => {
  it('needs a double whose digit is within the chaos factor', () => {
    expect(isRandomEventRoll(33, 5)).toBe(true);
    expect(isRandomEventRoll(55, 5)).toBe(true);
    expect(isRandomEventRoll(66, 5)).toBe(false);
    expect(isRandomEventRoll(22, 1)).toBe(false);
    expect(isRandomEventRoll(11, 1)).toBe(true);
    expect(isRandomEventRoll(99, 9)).toBe(true);
  });

  it('never treats a non-double or 100 as an event', () => {
    expect(isRandomEventRoll(100, 9)).toBe(false);
    expect(isRandomEventRoll(34, 9)).toBe(false);
    expect(isRandomEventRoll(0, 9)).toBe(false);
  });

  it('treats any double as an event in the one-page flavor', () => {
    expect(isRandomEventRoll(11, 1, 'one-page')).toBe(true);
    expect(isRandomEventRoll(99, 1, 'one-page')).toBe(true);
  });

  it('is reported by resolveFateChart', () => {
    expect(resolveFateChart(33, 'fifty-fifty', 5).randomEvent).toBe(true);
    expect(resolveFateChart(66, 'fifty-fifty', 5).randomEvent).toBe(false);
  });
});

describe('resolveFateCheck', () => {
  it('adds the odds modifier at a neutral chaos factor', () => {
    const cases: [string, number][] = [
      ['certain', 5],
      ['nearly-certain', 4],
      ['very-likely', 2],
      ['likely', 1],
      ['fifty-fifty', 0],
      ['unlikely', -1],
      ['very-unlikely', -2],
      ['nearly-impossible', -4],
      ['impossible', -5],
    ];
    for (const [odds, modifier] of cases) {
      expect(resolveFateCheck(1, 1, odds, 5, 'standard').modifier, odds).toBe(modifier);
    }
  });

  it('adds the standard chaos modifier', () => {
    const modifiers = [-5, -4, -2, -1, 0, 1, 2, 4, 5];
    for (let chaos = 1; chaos <= 9; chaos++) {
      expect(resolveFateCheck(1, 1, 'fifty-fifty', chaos, 'standard').modifier, `chaos ${chaos}`).toBe(
        modifiers[chaos - 1],
      );
    }
  });

  it('adds the mid-chaos modifier', () => {
    const modifiers = [-2, -1, -1, 0, 0, 0, 1, 1, 2];
    for (let chaos = 1; chaos <= 9; chaos++) {
      expect(resolveFateCheck(1, 1, 'fifty-fifty', chaos, 'mid').modifier, `chaos ${chaos}`).toBe(
        modifiers[chaos - 1],
      );
    }
  });

  it('adds the low-chaos modifier', () => {
    const modifiers = [-1, -1, 0, 0, 0, 0, 0, 1, 1];
    for (let chaos = 1; chaos <= 9; chaos++) {
      expect(resolveFateCheck(1, 1, 'fifty-fifty', chaos, 'low').modifier, `chaos ${chaos}`).toBe(
        modifiers[chaos - 1],
      );
    }
  });

  it('adds no chaos modifier with no chaos', () => {
    for (let chaos = 1; chaos <= 9; chaos++) {
      expect(resolveFateCheck(1, 1, 'fifty-fifty', chaos, 'none').modifier, `chaos ${chaos}`).toBe(0);
    }
  });

  it('maps the total onto the four answers', () => {
    const cases: [number, number, MythicAnswer][] = [
      [9, 9, 'exceptionalYes'],
      [6, 5, 'yes'],
      [5, 5, 'no'],
      [2, 3, 'no'],
      [2, 2, 'exceptionalNo'],
      [1, 1, 'exceptionalNo'],
    ];
    for (const [first, second, answer] of cases) {
      expect(resolveFateCheck(first, second, 'fifty-fifty', 5).answer, `${first}+${second}`).toBe(answer);
    }
  });

  it('matches the rulebook example of nearly-impossible at chaos 6', () => {
    const result = resolveFateCheck(3, 3, 'nearly-impossible', 6, 'standard');
    expect(result.modifier).toBe(-3);
    expect(result.total).toBe(3);
    expect(result.answer).toBe('exceptionalNo');
    expect(result.randomEvent).toBe(true);
  });

  it('brings a random event only for matching dice within the chaos factor', () => {
    expect(resolveFateCheck(3, 3, 'fifty-fifty', 6, 'standard').randomEvent).toBe(true);
    expect(resolveFateCheck(7, 7, 'fifty-fifty', 6, 'standard').randomEvent).toBe(false);
    expect(resolveFateCheck(10, 10, 'fifty-fifty', 9, 'standard').randomEvent).toBe(false);
  });
});

describe('resolveEventFocus', () => {
  const regularEdges: [number, number, string][] = [
    [1, 5, 'remote-event'],
    [6, 10, 'ambiguous-event'],
    [11, 20, 'new-npc'],
    [21, 40, 'npc-action'],
    [41, 45, 'npc-negative'],
    [46, 50, 'npc-positive'],
    [51, 55, 'move-toward-thread'],
    [56, 65, 'move-away-from-thread'],
    [66, 70, 'close-thread'],
    [71, 80, 'pc-negative'],
    [81, 85, 'pc-positive'],
    [86, 100, 'current-context'],
  ];

  it('reads both edges of every regular range', () => {
    for (const [low, high, id] of regularEdges) {
      expect(resolveEventFocus(low, populated).focus.id, `roll ${low}`).toBe(id);
      expect(resolveEventFocus(high, populated).focus.id, `roll ${high}`).toBe(id);
      expect(resolveEventFocus(low, populated).rolled.id, `roll ${low}`).toBe(id);
      expect(resolveEventFocus(high, populated).rolled.id, `roll ${high}`).toBe(id);
    }
  });

  it('covers 1..100 with exactly one row per roll', () => {
    for (let roll = 1; roll <= 100; roll++) {
      const matches = EVENT_FOCUS_TABLE.filter(item => roll >= item.range[0] && roll <= item.range[1]);
      expect(matches, `roll ${roll}`).toHaveLength(1);
      expect(resolveEventFocus(roll, populated).rolled.id, `roll ${roll}`).toBe(matches[0]!.id);
    }
  });

  it('replaces a focus that needs an empty list with current context', () => {
    const noCharacters = resolveEventFocus(21, lists({ threads: 3, features: 3 }));
    expect(noCharacters.focus.id).toBe('current-context');
    expect(noCharacters.rolled.id).toBe('npc-action');
    expect(noCharacters.replaced).toBe(true);

    const noThreads = resolveEventFocus(51, lists({ characters: 3, features: 3 }));
    expect(noThreads.focus.id).toBe('current-context');
    expect(noThreads.rolled.id).toBe('move-toward-thread');
    expect(noThreads.replaced).toBe(true);

    const noPositive = resolveEventFocus(46, lists());
    expect(noPositive.focus.id).toBe('current-context');
    expect(noPositive.rolled.id).toBe('npc-positive');
    expect(noPositive.replaced).toBe(true);
  });

  it('leaves a focus that needs no list, or a populated one, unchanged', () => {
    const noLists = resolveEventFocus(1, lists());
    expect(noLists.focus.id).toBe('remote-event');
    expect(noLists.replaced).toBe(false);

    const populatedCharacters = resolveEventFocus(21, lists({ characters: 1 }));
    expect(populatedCharacters.focus.id).toBe('npc-action');
    expect(populatedCharacters.replaced).toBe(false);
  });

  it('reads the prepared adventure table', () => {
    const preparedEdges: [number, number, string][] = [
      [1, 20, 'adventure-feature'],
      [21, 40, 'npc-action'],
      [41, 50, 'npc-negative'],
      [51, 55, 'npc-positive'],
      [56, 70, 'pc-negative'],
      [71, 80, 'pc-positive'],
      [81, 100, 'current-context'],
    ];
    for (const [low, high, id] of preparedEdges) {
      expect(resolveEventFocus(low, populated, true).focus.id, `roll ${low}`).toBe(id);
      expect(resolveEventFocus(high, populated, true).focus.id, `roll ${high}`).toBe(id);
    }
    for (let roll = 1; roll <= 100; roll++) {
      const matches = PREPARED_EVENT_FOCUS_TABLE.filter(
        item => roll >= item.range[0] && roll <= item.range[1],
      );
      expect(matches, `roll ${roll}`).toHaveLength(1);
      expect(resolveEventFocus(roll, populated, true).rolled.id, `roll ${roll}`).toBe(matches[0]!.id);
    }
  });

  it('replaces a prepared focus that needs an empty list', () => {
    const noFeatures = resolveEventFocus(1, lists({ characters: 3, threads: 3 }), true);
    expect(noFeatures.focus.id).toBe('current-context');
    expect(noFeatures.rolled.id).toBe('adventure-feature');
    expect(noFeatures.replaced).toBe(true);

    const noCharacters = resolveEventFocus(21, lists({ features: 3, threads: 3 }), true);
    expect(noCharacters.focus.id).toBe('current-context');
    expect(noCharacters.replaced).toBe(true);

    const pc = resolveEventFocus(56, lists(), true);
    expect(pc.focus.id).toBe('pc-negative');
    expect(pc.replaced).toBe(false);
  });
});

describe('listSectionDie', () => {
  it('picks the section die from the number of active sections', () => {
    expect(listSectionDie(5)).toBe(0);
    expect(listSectionDie(6)).toBe(4);
    expect(listSectionDie(10)).toBe(4);
    expect(listSectionDie(11)).toBe(6);
    expect(listSectionDie(15)).toBe(6);
    expect(listSectionDie(16)).toBe(8);
    expect(listSectionDie(20)).toBe(8);
    expect(listSectionDie(21)).toBe(10);
    expect(listSectionDie(25)).toBe(10);
  });

  it('always uses a d10 for a full list', () => {
    expect(listSectionDie(4, true)).toBe(10);
    expect(listSectionDie(25, true)).toBe(10);
  });
});

describe('resolveListRoll', () => {
  it('matches the rulebook examples', () => {
    const fourElements = resolveListRoll(4, 6);
    expect(fourElements.sectionDie).toBe(0);
    expect(fourElements.sectionRoll).toBeUndefined();
    expect(fourElements.line).toBe(3);
    expect(fourElements.index).toBe(2);

    const sevenElements = resolveListRoll(7, 1, 3);
    expect(sevenElements.sectionDie).toBe(4);
    expect(sevenElements.sectionRoll).toBe(3);
    expect(sevenElements.line).toBe(6);
    expect(sevenElements.index).toBe(5);

    const emptyLine = resolveListRoll(7, 9, 3);
    expect(emptyLine.line).toBe(10);
    expect(emptyLine.index).toBeNull();
  });

  it('maps a section roll onto a section', () => {
    const cases: [number, number][] = [
      [1, 1],
      [2, 1],
      [3, 6],
      [4, 6],
      [5, 11],
      [6, 11],
      [7, 16],
      [8, 16],
      [9, 21],
      [10, 21],
    ];
    for (const [sectionRoll, line] of cases) {
      expect(resolveListRoll(25, 1, sectionRoll).line, `section roll ${sectionRoll}`).toBe(line);
    }
  });

  it('maps a line d10 onto the five lines of its section', () => {
    const cases: [number, number][] = [
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 2],
      [5, 3],
      [6, 3],
      [7, 4],
      [8, 4],
      [9, 5],
      [10, 5],
    ];
    for (const [lineRoll, line] of cases) {
      expect(resolveListRoll(25, lineRoll, 1).line, `line roll ${lineRoll}`).toBe(line);
    }
  });

  it('rolls the section die over all five sections when full', () => {
    const result = resolveListRoll(4, 1, 10, true);
    expect(result.sectionDie).toBe(10);
    expect(result.sectionRoll).toBe(10);
    expect(result.line).toBe(21);
    expect(result.index).toBeNull();
  });
});

describe('resolveSceneTest', () => {
  it('exhaustively maps every roll and chaos factor', () => {
    for (let chaos = 1; chaos <= 9; chaos++) {
      for (let roll = 1; roll <= 10; roll++) {
        const expected = roll > chaos ? 'expected' : roll % 2 === 1 ? 'altered' : 'interrupt';
        expect(resolveSceneTest(roll, chaos), `roll ${roll} chaos ${chaos}`).toBe(expected);
      }
    }
  });
});

describe('resolveSceneAdjustments', () => {
  it('reads a single adjustment', () => {
    const result = resolveSceneAdjustments([3]);
    expect(result.adjustments).toEqual(['Reduce or remove an activity']);
  });

  it('turns 7 to 10 into two adjustments', () => {
    const result = resolveSceneAdjustments([8, 2, 9, 5]);
    expect(result.adjustments).toEqual(['Add a character', 'Remove an object']);
  });

  it('ignores further 7 to 10 rolls while collecting the pair', () => {
    const result = resolveSceneAdjustments([8, 9, 4, 6]);
    expect(result.adjustments).toEqual(['Increase an activity', 'Add an object']);
  });

  it('keeps a lone conditional roll at one adjustment', () => {
    const result = resolveSceneAdjustments([2, 9]);
    expect(result.adjustments).toEqual(['Add a character']);
  });
});

describe('adjustChaos', () => {
  it('lowers the chaos factor in control and raises it out of control', () => {
    expect(adjustChaos(5, true)).toBe(4);
    expect(adjustChaos(5, false)).toBe(6);
  });

  it('stays inside 1..9', () => {
    expect(adjustChaos(1, true)).toBe(1);
    expect(adjustChaos(9, false)).toBe(9);
  });
});

describe('thread progress tracks', () => {
  it('only allows the printed lengths and one Flashpoint box per phase but the last', () => {
    expect(newThreadTrack('a', 'A', 10).flashpoints).toHaveLength(1);
    expect(newThreadTrack('b', 'B', 15).flashpoints).toHaveLength(2);
    expect(newThreadTrack('c', 'C', 20).flashpoints).toHaveLength(3);
    expect(() => newThreadTrack('d', 'D', 12)).toThrow();
  });

  it('marks a played flashpoint without triggering another', () => {
    let track = newThreadTrack('t1', 'Thread', 15);
    let step = advanceThreadTrack(track, 2);
    expect(step.triggered).toBe(0);
    expect(step.track.points).toBe(2);

    step = advanceThreadTrack(step.track, 2);
    expect(step.triggered).toBe(0);
    expect(step.track.points).toBe(4);

    step = advanceThreadTrack(step.track, 2, true);
    expect(step.triggered).toBe(0);
    expect(step.track.points).toBe(6);
    expect(step.track.flashpoints[0]).toBe(true);
    expect(step.track.pendingFlashpoints).toBe(0);
  });

  it('triggers a flashpoint when a phase ends without one', () => {
    let track = newThreadTrack('t2', 'Thread', 15);
    track = advanceThreadTrack(track, 2).track;
    track = advanceThreadTrack(track, 2).track;
    expect(track.points).toBe(4);

    const step = advanceThreadTrack(track, 2);
    expect(step.track.points).toBe(8);
    expect(step.triggered).toBe(1);
    expect(step.track.flashpoints[0]).toBe(true);
    expect(step.track.pendingFlashpoints).toBe(1);
  });

  it('never exceeds the track length and concludes on reaching it', () => {
    for (const length of [10, 15, 20] as const) {
      let track = newThreadTrack(`x${length}`, 'Thread', length);
      for (let step = 0; step < 50 && !track.concluded; step++) {
        track = advanceThreadTrack(track, 5, true).track;
      }
      expect(track.points, `length ${length}`).toBe(length);
      expect(track.concluded, `length ${length}`).toBe(true);
    }
  });

  it('clamps points that a triggered flashpoint pushes past the length', () => {
    const started = advanceThreadTrack(newThreadTrack('t3', 'Thread', 10), 6).track;
    expect(started.points).toBe(8);
    expect(started.pendingFlashpoints).toBe(1);

    const finished = advanceThreadTrack(started, 6).track;
    expect(finished.points).toBe(10);
    expect(finished.concluded).toBe(true);
  });
});

describe('resolveThreadDiscovery', () => {
  it('maps every total onto its discovery result', () => {
    const cases: [number, number, string, number, boolean][] = [
      [2, 6, 'Progress +2', 2, false],
      [9, 0, 'Progress +2', 2, false],
      [1, 9, 'Flashpoint +2', 2, true],
      [1, 10, 'Track +1', 1, false],
      [4, 10, 'Track +1', 1, false],
      [5, 10, 'Progress +3', 3, false],
      [7, 10, 'Progress +3', 3, false],
      [8, 10, 'Flashpoint +3', 3, true],
      [9, 10, 'Track +2', 2, false],
      [10, 10, 'Strengthen Progress +1', 1, false],
      [10, 14, 'Strengthen Progress +1', 1, false],
      [10, 15, 'Strengthen Progress +2', 2, false],
      [10, 18, 'Strengthen Progress +2', 2, false],
    ];
    for (const [roll, progress, label, points, flashpoint] of cases) {
      const result = resolveThreadDiscovery(roll, progress);
      expect(result.label, `roll ${roll} progress ${progress}`).toBe(label);
      expect(result.points, `roll ${roll} progress ${progress}`).toBe(points);
      expect(result.flashpoint, `roll ${roll} progress ${progress}`).toBe(flashpoint);
      expect(result.total, `roll ${roll} progress ${progress}`).toBe(roll + progress);
    }
  });

  it('matches the rulebook example of progress 6 and a roll of 2', () => {
    const result = resolveThreadDiscovery(2, 6);
    expect(result.total).toBe(8);
    expect(result.label).toBe('Progress +2');
  });

  it('never gives discovery odds worse than fifty-fifty', () => {
    expect(discoveryOdds('very-unlikely')).toBe('fifty-fifty');
    expect(discoveryOdds('impossible')).toBe('fifty-fifty');
    expect(discoveryOdds('nearly-impossible')).toBe('fifty-fifty');
    expect(discoveryOdds('fifty-fifty')).toBe('fifty-fifty');
    expect(discoveryOdds('likely')).toBe('likely');
    expect(discoveryOdds('certain')).toBe('certain');
  });
});
