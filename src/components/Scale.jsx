import { useEffect, useRef, useState } from 'react';
import { fmtWeightNoUnit, round3 } from '../lib/weights.js';

const TWEEN_MS = 650;
const SETTLE_MS = 420;
const MAX_DEFLECTION = 3;

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function Scale({ value, maxScale = 10 }) {
  const target = value ?? 0;
  const [displayed, setDisplayed] = useState(0);
  const [settling, setSettling] = useState(false);
  const [stable, setStable] = useState(false);
  const displayedRef = useRef(0);
  const rafRef = useRef(null);
  const settleTimerRef = useRef(null);

  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  useEffect(() => {
    const to = target;
    const from = displayedRef.current;
    cancelAnimationFrame(rafRef.current);
    clearTimeout(settleTimerRef.current);
    setSettling(false);
    setStable(false);

    let start = null;
    const step = (time) => {
      if (start === null) start = time;
      const progress = Math.min((time - start) / TWEEN_MS, 1);
      const next = from + (to - from) * easeOut(progress);
      displayedRef.current = next;
      setDisplayed(next);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setSettling(true);
        settleTimerRef.current = setTimeout(() => {
          setSettling(false);
          setStable(true);
        }, SETTLE_MS);
      }
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(settleTimerRef.current);
    };
  }, [target]);

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
          <div className="lamp lamp-note">SIMULATION</div>
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
        <span className="scale-housing-label">CAPACITY 10.000 kg</span>
        <span className="scale-housing-label">TARE · ZERO</span>
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