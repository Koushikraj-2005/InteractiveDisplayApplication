/**
 * Guards against the previous item's weight still sitting on the scale being
 * accepted a second time.
 *
 * When a line is accepted the physical load is unchanged, so the very next
 * reading repeats the value that was just accepted. Without a latch, a second
 * line with the same target (a 2 kg then 2 kg formula) would be accepted
 * instantly without anything being weighed, recording a weight the operator
 * never put down. The latch stores the weight that was accepted and treats that
 * same reading as belonging to the item already weighed.
 *
 * The latch releases as soon as the reading moves away from the accepted
 * weight, because the only way to move it is to take the old item off, which
 * is exactly what the operator has to do anyway before the next line. It has
 * to release there: real formulas repeat targets back to back (Layer 1 asks
 * for 100, 50, 100, 100, 200, 200, 50, 50), and a genuine second 100 kg item
 * reads the same as the first. Holding the latch for the whole session made
 * every consecutive repeat permanently unweighable.
 *
 * Shared by the admin and staff apps so the rule cannot drift between them.
 */

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export class ReZeroLatch {
  /** Weight accepted on the previous line, or null when nothing is latched. */
  private accepted: number | null = null;

  /** Tolerance for "the reading moved", generous enough for a real scale. */
  private readonly epsilon: number;

  constructor(epsilon = 0.05) {
    this.epsilon = epsilon;
  }

  /** Latch the weight just accepted, so it cannot satisfy the next line. */
  latch(weight: number | null): void {
    this.accepted = weight == null ? null : round3(weight);
  }

  /**
   * Feed the current reading. A reading that has moved away from the accepted
   * weight clears the latch, because the operator has taken the old item off.
   * Fed from a live reading so the release happens as soon as the scale is
   * disturbed, not only when the next line happens to be checked.
   */
  observe(current: number | null): void {
    if (this.accepted == null || current == null) return;
    if (Math.abs(round3(current) - this.accepted) >= this.epsilon) {
      this.accepted = null;
    }
  }

  /** Forget the latch, e.g. when weighing is cancelled or starts over. */
  reset(): void {
    this.accepted = null;
  }

  /** True while the reading is still the one that was just accepted. */
  isStale(current: number | null): boolean {
    if (this.accepted == null || current == null) return false;
    return Math.abs(round3(current) - this.accepted) < this.epsilon;
  }

  /** Human readable reason, for the terminal to show. */
  staleReason(): string | null {
    return this.accepted == null
      ? null
      : 'Remove the previous item from the scale to continue';
  }
}
