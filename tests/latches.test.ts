/**
 * The two guards that stand between a raw scale reading and a recorded bill.
 *
 * The tare baseline turns the scale's running total into the weight of the item
 * actually being weighed, because the pan is never re-zeroed and nothing is
 * taken off it between lines. The stability latch remembers that the scale was
 * seen to settle at the weight now being accepted. Between them they are the
 * only things standing between a leftover reading and a recorded kilogram, so
 * they are pinned here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TareBaseline } from '../shared/tareBaseline.ts';
import { StabilityLatch } from '../shared/stabilityLatch.ts';
import { evaluateReading } from '../src/lib/weights.ts';

test('the pan as found is the zero point for the first line', () => {
  // A scale that never sits exactly at 0.000 kg must not turn line 1 into a
  // permanent overweight reading.
  const tare = new TareBaseline();
  tare.zeroAt(0.3);
  assert.equal(tare.net(0.3), 0);
  assert.equal(tare.net(51.3), 51);
  assert.equal(tare.net(51.9), 51.6);
});

test('the first line is measured raw when the pan starts empty', () => {
  const tare = new TareBaseline();
  tare.zeroAt(0);
  assert.equal(tare.net(51.2), 51.2);
  assert.equal(tare.baseValue(), 0);
});

test('a second line is measured as the difference, not the running total', () => {
  // The whole point. 100 kg is on the pan and the target is 50 kg, so the
  // reading climbs to 150 — that 150 must not be judged against a 50 kg target.
  const tare = new TareBaseline();
  tare.zeroAt(0);
  tare.carry(100);
  assert.equal(tare.net(100), 0, 'the accepted weight cannot satisfy the next line');
  assert.equal(tare.net(140), 40);
  assert.equal(tare.net(149.5), 49.5);
  assert.equal(tare.net(150.4), 50.4);
});

test('the zero point follows the reading each line was accepted at', () => {
  // A real session: 100, then 50, then 200, with nothing ever taken off.
  const tare = new TareBaseline();
  tare.zeroAt(0);
  const weights = [100, 50, 200];
  const recorded: number[] = [];
  let accumulated = 0;
  for (const target of weights) {
    accumulated += target;
    assert.equal(evaluateReading(target, tare.net(accumulated)).correct, true);
    recorded.push(tare.net(accumulated) as number);
    tare.carry(accumulated);
  }
  assert.deepEqual(recorded, weights, 'each line records its own weight, not the total');
  assert.equal(tare.baseValue(), 350, 'the pan ends up carrying the whole batch');
});

test('a repeated target is weighable again even with the pan left loaded', () => {
  // Formulas really do repeat targets back to back (100, 50, 100, 100, 200).
  // Refusing the second 100 kg because the pan already reads 100 was the bug the
  // baseline replaces.
  const tare = new TareBaseline();
  tare.zeroAt(0);
  tare.carry(100);
  assert.equal(tare.net(100), 0, 'nothing added yet');
  assert.equal(evaluateReading(100, tare.net(199.9)).correct, false, 'still 0.1 kg short');
  assert.equal(tare.net(200.4), 100.4);
  assert.equal(evaluateReading(100, tare.net(200.4)).correct, true);
});

test('the difference is never negative, and a dropped load is flagged', () => {
  const tare = new TareBaseline();
  tare.zeroAt(0);
  tare.carry(100);
  assert.equal(tare.underBase(100), false, 'nothing has come off yet');
  assert.equal(tare.underBase(30), true, '70 kg came off the pan');
  assert.equal(tare.net(30), 0, 'clamped, not a negative weight for the item');
  // A negative net could never reach a 1 kg-or-more target anyway, so the line
  // is stuck until the operator deals with the pan rather than silently
  // accepting a reading that lost material.
  assert.equal(evaluateReading(50, tare.net(30)).correct, false);
});

test('a reading at the zero point is not treated as a removal', () => {
  // Tolerance is tight because the flag only has to survive a little noise; the
  // clamping that actually protects the bill happens in net() regardless.
  const tare = new TareBaseline();
  tare.zeroAt(0);
  tare.carry(51.2);
  assert.equal(tare.underBase(51.2), false);
  assert.equal(tare.underBase(51.18), false, 'within epsilon is still the same load');
  assert.equal(tare.underBase(51.0), true, '50 g below the zero point is flagged');
  assert.equal(tare.net(51.0), 0, 'and the net weight cannot go negative');
});

test('an outlying low frame never moves the zero point', () => {
  // Following a bad frame down would shift every remaining line by that much
  // and accept weight that was never weighed.
  const tare = new TareBaseline();
  tare.zeroAt(0);
  tare.carry(100);
  tare.net(12.5);
  assert.equal(tare.baseValue(), 100, 'reading a bad frame does not re-zero the scale');
  assert.equal(tare.net(150), 50, 'the line is still measured against the real zero');
});

test('a null reading yields a null weight rather than a zero', () => {
  // Zero would read as 0 kg on the terminal and look like a real measurement.
  const tare = new TareBaseline();
  tare.zeroAt(null);
  assert.equal(tare.net(null), null);
  assert.equal(tare.underBase(null), false);
  tare.carry(100);
  assert.equal(tare.net(null), null);
  assert.equal(tare.baseValue(), 100, 'a dropped frame does not clear the zero point');
});

test('carrying nothing leaves the zero point alone', () => {
  const tare = new TareBaseline();
  tare.zeroAt(0);
  tare.carry(100);
  tare.carry(null);
  assert.equal(tare.baseValue(), 100);
});

test('reset forgets the zero point', () => {
  const tare = new TareBaseline();
  tare.zeroAt(0);
  tare.carry(100);
  tare.reset();
  assert.equal(tare.baseValue(), 0);
  assert.equal(tare.net(100), 100);
});

test('the baseline is not fooled by floating point noise', () => {
  const tare = new TareBaseline();
  tare.zeroAt(0);
  tare.carry(51.2);
  assert.equal(tare.net(51.2 + 1e-12), 0, 'a hair of noise is the same weight');
  assert.equal(tare.net(101.2), 50);
});

test('a deep session of repeat targets records every line correctly', () => {
  // The invariant the whole feature exists to protect: on a pan that is never
  // cleared, every accepted line still records its own weight on the bill.
  const tare = new TareBaseline();
  tare.zeroAt(0);
  const targets = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 200];
  let accumulated = 0;
  for (const target of targets) {
    for (const offset of [0, 0.4, 0.999]) {
      const reading = tare.net(accumulated + target + offset);
      assert.equal(
        evaluateReading(target, reading).correct,
        true,
        `${target} kg at +${offset} must be accepted`,
      );
    }
    assert.equal(evaluateReading(target, tare.net(accumulated + target - 1)).correct, false);
    accumulated += target;
    tare.carry(accumulated);
  }
  assert.equal(tare.baseValue(), 575);
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