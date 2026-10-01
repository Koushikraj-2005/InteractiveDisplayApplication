/**
 * Turns the scale's running total into the weight of the item being weighed.
 *
 * The scale is never re-zeroed between lines, and nothing is taken off the pan
 * at the end of a line, so the reading only ever grows. Line 1 asks for 100 kg:
 * the reading climbs to 100 and the line is accepted. Line 2 asks for 50 kg, so
 * the reading climbs to 150 — that 150 is everything sitting on the pan, not the
 * weight of the item just added. Judged against the target directly, line 2
 * would read as 50 kg overweight and every line after the first would be worse
 * still, because the error is the whole weight of the batch before it.
 *
 * So the reading the scale showed when the line started is held as a zero point
 * and subtracted from every reading on that line. The net weight is what gets
 * compared to the target and what gets recorded on the bill, while the scale
 * itself is left running, which is what a real pan does.
 *
 * The zero point is captured from whatever the scale reads when weighing starts,
 * so a pan that is not perfectly empty to begin with is accounted for too, and
 * it is then carried forward to the reading each line was accepted at.
 *
 * A reading that falls below the zero point means material came off the pan.
 * The difference is clamped at zero and the terminal says so, rather than the
 * zero point quietly following the reading down: one outlying frame would then
 * shift every remaining line by that much and accept weight that was never on
 * the scale.
 *
 * Shared by the admin and staff apps so the rule cannot drift between them.
 */

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export class TareBaseline {
  /** The accumulated reading treated as zero for the line being weighed. */
  private base = 0;

  /** Tolerance for "the reading moved", generous enough for a real scale. */
  private readonly epsilon: number;

  constructor(epsilon = 0.05) {
    this.epsilon = epsilon;
  }

  /**
   * Treat whatever the scale is reading right now as zero. Used when weighing
   * starts, so the first line is measured against the pan as it was found, and
   * by the ZERO HERE button when material has been taken off mid-session.
   */
  zeroAt(current: number | null): void {
    this.base = current == null ? 0 : round3(current);
  }

  /**
   * The weight sitting on top of the zero point, which is the item being
   * weighed. Never negative, and null when the scale is reporting nothing.
   */
  net(current: number | null): number | null {
    if (current == null) return null;
    return Math.max(0, round3(round3(current) - this.base));
  }

  /**
   * True when the reading has dropped below the zero point, i.e. material came
   * off the pan. The line cannot be completed until the zero point is re-taken.
   */
  underBase(current: number | null): boolean {
    if (current == null) return false;
    return round3(current) - this.base < -this.epsilon;
  }

  /**
   * The accumulated reading a line was accepted at becomes the zero point for
   * the next one, because the finished item is still on the pan.
   */
  carry(accumulated: number | null): void {
    if (accumulated != null) this.base = round3(accumulated);
  }

  /** Forget the zero point, e.g. when weighing is cancelled or starts over. */
  reset(): void {
    this.base = 0;
  }

  /** The zero point itself, so the terminal can show what the pan is carrying. */
  baseValue(): number {
    return this.base;
  }
}