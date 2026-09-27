/**
 * Guards the "NEXT ITEM" button against the previous item's weight still
 * sitting on the scale.
 *
 * When a line is accepted the physical load is unchanged, so the very next
 * reading repeats the value that was just accepted. Without a latch, a second
 * line with the same target (a 2 kg then 2 kg formula) is accepted instantly
 * without anything being weighed. The latch stores the weight that was
 * accepted and requires a materially different reading before the next line
 * can be accepted, which in practice means the operator has removed the old
 * item and put down the new one.
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
