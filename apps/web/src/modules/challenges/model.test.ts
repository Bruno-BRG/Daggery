import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { IronRank } from '@daggery/shared';
import {
  addTicks, boxTicks, clamp, COUNTDOWN_SIZES, createCountdown, createTrack, harmFromFoe, inflictHarm, isTrackDoc, markProgress, progressTicks,
  rankForAdversary, RANK_OPTIONS, rankTicks, score, TICKS_PER_BOX, toggleCountdown, TRACK_BOXES, TRACK_TICKS, trackCaption, TYPE_ORDER, TYPE_TITLE,
} from './model';

test('the ranks come from the shared engine with their printed tick values', () => {
  assert.deepEqual(RANK_OPTIONS.map(rank => rank.label), ['Minor', 'Serious', 'Grave', 'Dire', 'Legendary']);
  assert.deepEqual(RANK_OPTIONS.map(rank => rank.ticks), [12, 8, 4, 2, 1]);
  assert.deepEqual(RANK_OPTIONS.map(rank => rank.id), ['troublesome', 'dangerous', 'formidable', 'extreme', 'epic']);
  for (const rank of RANK_OPTIONS) assert.equal(rankTicks(rank.id), rank.ticks);
});

test('a track is ten boxes of four ticks, forty ticks in all', () => {
  assert.equal(TRACK_TICKS, 40);
  assert.equal(TICKS_PER_BOX, 4);
  assert.equal(TRACK_BOXES, 10);
});

test('mark progress adds the rank ticks and never passes ten boxes', () => {
  assert.equal(markProgress(0, 'troublesome'), 12);
  assert.equal(markProgress(0, 'dangerous'), 8);
  assert.equal(markProgress(0, 'formidable'), 4);
  assert.equal(markProgress(0, 'extreme'), 2);
  assert.equal(markProgress(0, 'epic'), 1);
  assert.equal(markProgress(12, 'troublesome'), 24);
  assert.equal(markProgress(32, 'troublesome'), 40);
  assert.equal(markProgress(38, 'dangerous'), 40);
  assert.equal(markProgress(40, 'troublesome'), 40);
  assert.equal(markProgress(-8, 'formidable'), 4);
});

test('the progress score counts full boxes only', () => {
  assert.equal(score(0), 0);
  assert.equal(score(3), 0);
  assert.equal(score(4), 1);
  assert.equal(score(7), 1);
  assert.equal(score(12), 3);
  assert.equal(score(39), 9);
  assert.equal(score(40), 10);
  assert.equal(score(400), 10);
  assert.equal(score(-4), 0);
});

test('clamp keeps values inside their bounds', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-2, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test('single-tick changes stay between zero and forty', () => {
  assert.equal(addTicks(0, -1), 0);
  assert.equal(addTicks(0, 1), 1);
  assert.equal(addTicks(12, -1), 11);
  assert.equal(addTicks(40, 1), 40);
  assert.equal(addTicks(39.7, 1), 40);
});

test('each box reports its own four-tick state for the header bar', () => {
  assert.deepEqual(boxTicks(0), Array.from({ length: 10 }, () => 0));
  assert.deepEqual(boxTicks(6), [4, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(boxTicks(40), Array.from({ length: 10 }, () => 4));
  assert.deepEqual(boxTicks(42), Array.from({ length: 10 }, () => 4));
  assert.deepEqual(boxTicks(-2), Array.from({ length: 10 }, () => 0));
  assert.ok(boxTicks(37).every(value => value >= 0 && value <= 4));
});

test('countdown segments fill up to the click and unfill from it', () => {
  assert.equal(toggleCountdown(0, 6, 2), 3);
  assert.equal(toggleCountdown(3, 6, 1), 1);
  assert.equal(toggleCountdown(3, 6, 3), 4);
  assert.equal(toggleCountdown(6, 6, 5), 5);
  assert.equal(toggleCountdown(2, 8, -1), 2);
  assert.equal(toggleCountdown(2, 8, 8), 2);
  assert.deepEqual([...COUNTDOWN_SIZES], [4, 6, 8, 10, 12]);
});

test('captions show the rank with full boxes, or the filled segments', () => {
  const oath = createTrack('oath', 'Break the siege', 'formidable', '2026-01-01T00:00:00.000Z');
  assert.equal(trackCaption(oath), 'Grave · 0/10 boxes');
  assert.equal(trackCaption({ ...oath, ticks: 6 }), 'Grave · 1/10 boxes');
  assert.equal(trackCaption({ ...oath, ticks: 39 }), 'Grave · 9/10 boxes');
  const clock = createCountdown('The ritual completes', 8, '2026-01-01T00:00:00.000Z');
  assert.equal(trackCaption(clock), '0/8');
  assert.equal(trackCaption({ ...clock, filled: 8 }), '8/8');
});

test('the stored document shape matches what the page writes', () => {
  const oath = createTrack('journey', 'Cross the ash flats', 'dangerous', '2026-01-01T00:00:00.000Z');
  assert.deepEqual(oath, {
    kind: 'track', type: 'journey', name: 'Cross the ash flats', rank: 'dangerous',
    ticks: 0, notes: '', done: false, updated: '2026-01-01T00:00:00.000Z',
  });
  const clock = createCountdown('Guards find you', 6, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(clock, {
    kind: 'track', type: 'countdown', name: 'Guards find you', size: 6,
    filled: 0, notes: '', done: false, updated: '2026-01-01T00:00:00.000Z',
  });
});

test('only well-formed track documents are read from the sync namespace', () => {
  const oath = createTrack('oath', 'Keep the lantern lit', 'epic');
  const clock = createCountdown('The tide comes in', 12);
  assert.equal(isTrackDoc(oath), true);
  assert.equal(isTrackDoc(clock), true);
  assert.equal(isTrackDoc(clock.kind === 'track' ? clock : null), true);
  assert.equal(isTrackDoc(null), false);
  assert.equal(isTrackDoc({}), false);
  assert.equal(isTrackDoc({ ...oath, kind: 'loot' }), false);
  assert.equal(isTrackDoc({ ...oath, rank: 'unknown' }), false);
  assert.equal(isTrackDoc({ ...oath, ticks: 'many' }), false);
  assert.equal(isTrackDoc({ ...clock, size: 5 }), false);
  assert.equal(isTrackDoc({ ...clock, filled: 'all' }), false);
  for (const rank of ['troublesome', 'dangerous', 'formidable', 'extreme', 'epic'] as IronRank[]) {
    assert.equal(isTrackDoc(createTrack('scene', 'A duel at dusk', rank)), true);
  }
});

test('a fight marks the foe’s rank for each harm, and a bond is always one tick', () => {
  assert.equal(inflictHarm(0, 'troublesome', 1), 12);
  assert.equal(inflictHarm(0, 'dangerous', 2), 16);
  assert.equal(inflictHarm(0, 'formidable', 3), 12);
  assert.equal(inflictHarm(0, 'extreme', 2), 4);
  assert.equal(inflictHarm(0, 'epic', 1), 1);
  assert.equal(inflictHarm(38, 'troublesome', 1), 40);
  assert.equal(inflictHarm(5, 'epic', -3), 5);
  assert.equal(progressTicks('bond', 'epic'), 1);
  assert.equal(progressTicks('bond', 'troublesome'), 1);
  assert.equal(progressTicks('oath', 'troublesome'), 12);
  assert.equal(progressTicks('fight', 'extreme'), 2);
});

test('a Daggerheart adversary sets the rank of its fight, raised for a pack of weaker foes only', () => {
  assert.equal(rankForAdversary('Standard', 1), 'troublesome');
  assert.equal(rankForAdversary('Standard', 1, 'small'), 'dangerous');
  assert.equal(rankForAdversary('Minion', 1, 'large'), 'formidable');
  assert.equal(rankForAdversary('Standard', 2, 'large'), 'extreme');
  assert.equal(rankForAdversary('Bruiser', 2, 'small'), 'formidable');
  assert.equal(rankForAdversary('Solo', 3, 'large'), 'epic');
  assert.equal(harmFromFoe('formidable'), 3);
});

test('fights and bonds get their own captions and are valid track documents', () => {
  const fight = createTrack('fight', 'The mine boss', 'formidable', '2026-01-01T00:00:00.000Z');
  assert.equal(trackCaption(fight), 'Grave foe · harm 3 · 0/10 boxes');
  assert.equal(trackCaption({ ...fight, ticks: 12 }), 'Grave foe · harm 3 · 3/10 boxes');
  const bonds = createTrack('bond', 'Bonds', 'troublesome', '2026-01-01T00:00:00.000Z');
  assert.equal(trackCaption({ ...bonds, ticks: 6 }), '6 bonds · 1/10 boxes');
  assert.equal(isTrackDoc(fight), true);
  assert.equal(isTrackDoc({ ...fight, adversary: 'goblin', pack: 'small' }), true);
  assert.equal(isTrackDoc(bonds), true);
  assert.deepEqual(TYPE_ORDER, ['oath', 'fight', 'journey', 'bond', 'scene', 'countdown']);
  assert.equal(TYPE_TITLE.oath, 'Vows');
});
