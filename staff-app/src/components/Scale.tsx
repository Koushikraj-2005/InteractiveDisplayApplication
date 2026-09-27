import { useEffect, useRef, useState } from 'react';
import { fmtWeightNoUnit, round3 } from '../lib/weights.ts';

const TWEEN_MS = 650;
const LIVE_TWEEN_MS = 120;
const SETTLE_MS = 420;
const MAX_DEFLECTION = 3;

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export interface ScaleProps {
  /** The weight to display, or null/undefined to fall back to zero. */
  value: number | null | undefined;
  /**
   * Cosmetic full-scale used to draw the pan deflection. NOT the machine's
   * rated capacity — that is unknown, and treating it as a limit produced a
   * false over-range warning.
   */
  maxScale?: number;
  /** True when the reading is streamed from the real device. */
  live?: boolean;
  /** Device-reported stability; overrides the animated guess when provided. */
  liveStable?: boolean | null;
}

export function Scale({
  value,
  maxScale = 50,
  live = false,
  liveStable = null,
}: ScaleProps) {
  const target = value ?? 0;
  const [displayed, setDisplayed] = useState(0);
  const [settling, setSettling] = useState(false);
  const [settled, setSettled] = useState(false);
  const displayedRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The device decides when a weighing has stopped moving; the animation only
  // guesses that for typed readings.
  const stable = live && liveStable !== null && liveStable !== undefined
    ? Boolean(liveStable)
    : settled;

  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  useEffect(() => {
    const to = target;
    const from = displayedRef.current;
    const duration = live ? LIVE_TWEEN_MS : TWEEN_MS;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
    setSettling(false);
    setSettled(false);

    let start: number | null = null;
    const step = (time: number) => {
      if (start === null) start = time;
      const progress = Math.min((time - start) / duration, 1);
      const next = from + (to - from) * easeOut(progress);
      displayedRef.current = next;
      setDisplayed(next);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setSettling(true);
        settleTimerRef.current = setTimeout(() => {
          setSettling(false);
          setSettled(true);
        }, SETTLE_MS);
      }
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
    };
  }, [target, live]);

  // Purely cosmetic: the drawn pan needs some full-scale to deflect against.
  // It is deliberately not the machine's rated capacity, which is unknown and
  // would otherwise be reported as an over-range warning on false grounds.
  const deflection = (Math.min(displayed, maxScale) / maxScale) * MAX_DEFLECTION;
  const zeroed = round3(displayed) === 0;

  return (
    <div className="scale">
      <div className="scale-lcd-bezel">
        <div className="scale-lcd">
          <span className="scale-reading" data-status={stable ? 'on' : 'transit'}>
            {fmtWeightNoUnit(displayed)}
          </span>
          <span className="scale-lcd-unit">kg</span>
        </div>
        <div className="scale-lamps">
          <div className="lamp">
            <span className={`lamp-dot stable ${stable ? 'on' : ''}`} />
            <span>STABLE</span>
          </div>
          <div className="lamp">
            <span className={`lamp-dot zero ${stable && zeroed ? 'on' : ''}`} />
            <span>ZERO</span>
          </div>
          <div className="lamp lamp-note">{live ? 'LIVE · YH-T7E' : 'SIMULATION'}</div>
        </div>
        <div className="scale-brand">
          <span>DIGITAL SCALE</span>
          <span>KW-3000</span>
        </div>
      </div>

      <div className={`scale-platform ${settling ? 'settling' : ''}`}>
        <div className="scale-pan" style={{ transform: `translateY(${deflection}px)` }}>
          <span className="scale-pan-screw" />
          <span className="scale-pan-screw" />
          <span className="scale-pan-screw" />
        </div>
      </div>

      <div className="scale-housing">
        <span className="scale-housing-label">TARE · ZERO</span>
        <span className="scale-housing-label">DIGITAL PLATFORM</span>
      </div>

      <div className="scale-feet">
        <span className="scale-foot" />
        <span className="scale-foot" />
        <span className="scale-foot" />
        <span className="scale-foot" />
      </div>
    </div>
  );
}