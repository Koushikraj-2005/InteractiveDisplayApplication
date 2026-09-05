import { useEffect, useRef } from 'react';
import { fmtSignedDiff, fmtWeight, parseWeight } from '../lib/weights.js';
import { speak } from '../lib/tts.js';
import { weightSource } from '../lib/weightSource.js';
import { Scale } from '../components/Scale.jsx';

const SOURCE_LABEL =
  weightSource.mode === 'manual' ? 'MANUAL ENTRY (SIMULATED)' : 'DEVICE READING (RS232)';

export function WeighingTerminal({
  cart,
  activeIndex,
  activeItem,
  status,
  reading,
  nextEnabled,
  onReading,
  onNext,
}) {
  const inputRef = useRef(null);
  const current = parseWeight(reading);

  useEffect(() => {
    if (!activeItem) return;
    speak(activeItem.name);
    inputRef.current?.focus();
  }, [activeItem]);

  if (!activeItem) return null;

  const diffZone =
    status.difference == null
      ? 'neutral'
      : status.difference === 0
        ? 'zero'
        : status.difference < 0
          ? 'neg'
          : 'pos';

  return (
    <section className="stage terminal">
      <div className="terminal-bar">
        <span className="terminal-title">WEIGHING TERMINAL</span>
        <span className="terminal-meta">
          <span className="terminal-item">
            Machine: <b>SIMULATION</b>
          </span>
          <span className="terminal-item">
            Status: <b className="b-ready">READY</b>
          </span>
          <span className="terminal-item terminal-source">{SOURCE_LABEL}</span>
        </span>
      </div>

      <div className="terminal-layout">
        <aside className="panel queue-panel">
          <div className="panel-title">WEIGHING QUEUE</div>
          <div className="queue">
            <div className="queue-row queue-head">
              <span>No.</span>
              <span>Item</span>
              <span>Required</span>
              <span>Status</span>
            </div>
            {cart.map((item, index) => (
              <div key={item.uid} className={`queue-row ${item.status}`}>
                <span className="num">{String(index + 1).padStart(2, '0')}</span>
                <span>{item.name}</span>
                <span className="num">{fmtWeight(item.required)}</span>
                <span className={`queue-status ${item.status}`}>
                  {item.status === 'completed' ? '✓ COMPLETE' : item.status.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </aside>

        <div className="panel scale-panel">
          <div className="current-item">
            <div className="current-item-label">CURRENT ITEM</div>
            <div className="current-item-name">{activeItem.name.toUpperCase()}</div>
            <div className="current-item-required">
              Required Weight: {fmtWeight(activeItem.required)}
              <button
                type="button"
                className="speaker-btn"
                onClick={() => speak(activeItem.name)}
                aria-label={`Replay item name ${activeItem.name}`}
                title="Replay item name"
              >
                🔊
              </button>
            </div>
          </div>

          <div className="scale-wrap">
            <Scale value={current} maxScale={10} />
          </div>
        </div>

        <aside className="panel input-panel">
          <div className="panel-title">WEIGHT INPUT</div>

          <div className="metric">
            <div className="metric-label">Required Weight</div>
            <div className="metric-value">{fmtWeight(activeItem.required)}</div>
          </div>

          <div className="metric metric-input">
            <div className="metric-label">Current Weight</div>
            <div className="input-row">
              <input
                ref={inputRef}
                id="current-weight"
                className="weight-input"
                type="number"
                step="0.001"
                min="0"
                placeholder="0.000"
                inputMode="decimal"
                value={reading}
                onChange={(event) => onReading(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    onReading(event.target.value);
                    if (nextEnabled) onNext();
                  }
                }}
              />
              <span className="unit">kg</span>
            </div>
            <div className="metric-hint">Simulated scale reading</div>
          </div>

          <div className="metric">
            <div className="metric-label">Difference</div>
            <div className={`metric-value diff-${diffZone}`}>
              {status.difference == null
                ? '—'
                : fmtSignedDiff(status.difference)}
            </div>
          </div>

          <div className={`status-box status-${status.type}`}>
            <div className="status-title">{status.title}</div>
            <div className="status-detail">{status.detail}</div>
          </div>

          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            disabled={!nextEnabled}
            onClick={onNext}
          >
            NEXT ITEM
          </button>
        </aside>
      </div>
    </section>
  );
}