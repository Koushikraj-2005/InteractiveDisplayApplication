/**
 * The two latches that stand between a reading and a recorded bill.
 *
 * The re-zero latch stops the weight that was just accepted from satisfying the
 * next line, and the stability latch remembers that the scale was seen to
 * settle at the weight now being accepted. Between them they are the only
 * things standing between a leftover reading and a recorded kilogram, so they
 * are pinned here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ReZeroLatch } from '../shared/reZeroLatch.ts';
import { StabilityLatch } from '../shared/stabilityLatch.ts';

test('re-zero latch blocks the weight that was just accepted', () => {
  const latch = new ReZeroLatch();
  latch.latch(51.2);
  assert.equal(latch.isStale(51.2), true, 'the same weight is still on the pan');
  assert.equal(latch.isStale(51.19), true, 'within epsilon counts as the same weight');
  assert.equal(latch.isStale(51.0), false, '0.2 kg away is a genuinely different weight');
  assert.ok(latch.staleReason());
});

test('re-zero latch releases when the pan is emptied', () => {
  const latch = new ReZeroLatch();
  latch.latch(51.2);
  latch.observe(0);
  assert.equal(latch.isStale(51.2), false, 'an empty pan means the item was taken off');
  assert.equal(latch.staleReason(), null);
});

test('re-zero latch lets a genuine repeat target be weighed again', () => {
  // Formulas really do repeat targets back to back (100, 50, 100, 100, 200).
  // Holding the latch for the whole session made every repeat unweighable.
  const latch = new ReZeroLatch();
  latch.latch(100);
  latch.observe(0); // operator takes the first 100 kg off
  assert.equal(latch.isStale(100), false);
  assert.equal(latch.isStale(99.6), false);
});

test('re-zero latch reset forgets everything', () => {
  const latch = new ReZeroLatch();
  latch.latch(51.2);
  latch.reset();
  assert.equal(latch.isStale(51.2), false);
  assert.equal(latch.staleReason(), null);
});

test('re-zero latch ignores a null reading rather than releasing', () => {
  // A dropped frame is not proof the item came off. Releasing here would let
  // the same weight satisfy the next line the moment the link hiccups.
  const latch = new ReZeroLatch();
  latch.latch(51.2);
  latch.observe(null);
  assert.equal(latch.isStale(51.2), true);
});

test('re-zero latch with nothing latched never blocks anything', () => {
  const latch = new ReZeroLatch();
  assert.equal(latch.isStale(51.2), false);
  assert.equal(latch.isStale(null), false);
  assert.equal(latch.staleReason(), null);
});

test('stability latch requires the scale to have settled at the weight', () => {
  const latch = new StabilityLatch();
  assert.equal(latch.hasSettled(51.2), false, 'nothing observed yet');

  latch.observe(51.2, true, true);
  assert.equal(latch.hasSettled(51.2), true, 'a stable correct reading settles it');
});

test('stability latch ignores a correct reading the scale called unstable', () => {
  const latch = new StabilityLatch();
  latch.observe(51.2, false, true);
  assert.equal(
    latch.hasSettled(51.2),
    false,
    'a weight that swept past mid-placement must not count as settled',
  );
});

test('stability latch survives a flicker at the same weight', () => {
  // The whole reason this latch exists: requiring the flag to hold for the
  // whole 4s countdown meant ordinary flicker restarted the countdown and
  // left a correct line stuck on TARGET REACHED.
  const latch = new StabilityLatch();
  latch.observe(51.2, true, true);
  latch.observe(51.2, false, true); // flicker
  assert.equal(latch.hasSettled(51.2), true, 'a momentary flicker must not un-settle');
});

test('stability latch re-arms when the weight changes', () => {
  const latch = new StabilityLatch();
  latch.observe(51.2, true, true);
  latch.observe(48.0, true, true); // a different, still-correct-for-something weight
  assert.equal(
    latch.hasSettled(51.2),
    false,
    'settling at one weight says nothing about a different one',
  );
});

test('stability latch re-arms when the reading goes wrong or missing', () => {
  const latch = new StabilityLatch();
  latch.observe(51.2, true, true);
  latch.observe(51.2, true, false); // no longer correct
  assert.equal(latch.hasSettled(51.2), false);

  latch.observe(51.2, true, true);
  latch.observe(null, true, true); // nothing being read
  assert.equal(latch.hasSettled(51.2), false);
  assert.equal(latch.hasSettled(null), false);
});

test('stability latch reset forgets the settled reading', () => {
  const latch = new StabilityLatch();
  latch.observe(51.2, true, true);
  latch.reset();
  assert.equal(latch.hasSettled(51.2), false);
});

test('stability latch is not fooled by floating point noise', () => {
  const latch = new StabilityLatch();
  latch.observe(51.2, true, true);
  assert.equal(latch.hasSettled(51.2 + 1e-12), true, 'a hair of noise is the same weight');
});
