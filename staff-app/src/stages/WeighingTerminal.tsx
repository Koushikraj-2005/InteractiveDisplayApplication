import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ScaleReading } from '../../../shared/scale.ts';
import { alertsEnabled, primeAlertAudio, toggleAlertsEnabled } from '../../../shared/alerts.ts';
import { useVerdictAlert } from '../../../shared/useVerdictAlert.ts';
import {
  fmtSignedDiff,
  fmtWeight,
  fmtWeightNoUnit,
  parseWeight,
  type ReadingVerdict,
} from '../lib/weights.ts';
import { speakItem, voiceEngine } from '../lib/tts.ts';
import { localizedName, VOICE_LANGS } from '../lib/items.ts';
import { Scale } from '../components/Scale.tsx';
import type { DeviceState, WeightMode } from '../lib/weightSource.ts';
import type { CartItem, LangCode } from '../lib/types.ts';

const voiceLabel = (code: LangCode): string => {
  const lang = VOICE_LANGS.find((candidate) => candidate.code === code);
  return lang ? lang.label.split(' / ')[0] : code.toUpperCase();
};

const deviceStateLabel = (device: Partial<DeviceState>): string => {
  if (device.status === 'connected') return 'ONLINE';
  if (device.status === 'connecting') return 'CONNECTING';
  if (device.status === 'reconnecting') return 'RECONNECTING';
  if (device.status === 'failed') return 'UNAVAILABLE';
  return 'OFFLINE';
};

export interface WeighingTerminalProps {
  cart: CartItem[];
  activeIndex: number;
  activeItem: CartItem | null;
  status: ReadingVerdict;
  /** Raw text from the keypad; null/'' in live mode. */
  reading: string | number | null;
  nextEnabled: boolean;
  /** Why NEXT is blocked, e.g. the previous item is still on the scale. */
  nextBlockedReason?: string | null;
  voiceLang: LangCode;
  mode?: WeightMode;
  device?: DeviceState | null;
  live?: ScaleReading | null;
  onReading?: (value: string) => void;
  onNext?: () => void;
  onCancel?: () => void;
}

export function WeighingTerminal({
  cart,
  activeIndex,
  activeItem,
  status,
  reading,
  nextEnabled,
  nextBlockedReason = null,
  voiceLang,
  mode = 'simulation',
  device = null,
  live = null,
  onReading,
  onNext,
  onCancel,
}: WeighingTerminalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [alertsOn, setAlertsOn] = useState(alertsEnabled);
  const isLive = mode === 'weighing';
  const connected = isLive && Boolean(device?.connected);
  const scaleLabel = isLive ? deviceStateLabel(device ?? {}) : 'SIMULATION';
  const offline = isLive && !connected;
  const current = parseWeight(reading);
  // Port is open but no usable reading: either the scale is silent, or it is
  // sending bytes we cannot frame. Both are almost always a wiring, cable-type
  // or baud-rate mismatch rather than a dead cable.
  const noReading = connected && current == null;

  useEffect(() => {
    if (!activeItem) return;
    speakItem(activeItem, voiceLang);
    if (!isLive) inputRef.current?.focus();
  }, [activeItem, voiceLang, isLive]);

  // Audible under/over/accepted cues, and the first tap also unlocks the
  // audio context that browsers keep suspended until a user gesture.
  useEffect(() => {
    primeAlertAudio();
  }, []);

  useVerdictAlert(status.type, { enabled: alertsOn });

  // These are optional so the terminal can be used read-only; guard at the
  // call sites that render the interactive controls.
  const handleReading = onReading ?? (() => {});
  const handleNext = onNext ?? (() => {});

  if (!activeItem) return null;

  const sourceLabel = isLive ? 'LIVE SERIAL READING (RS232)' : 'MANUAL ENTRY (SIMULATED)';
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
            Machine: <b>{isLive ? 'DEVICE (YH-T7E)' : 'SIMULATION'}</b>
          </span>
          <span className="terminal-item">
            Status:{' '}
            <b className={offline ? 'b-warn' : 'b-ready'}>
              {offline ? 'AWAITING DEVICE' : 'READY'}
            </b>
          </span>
          <span
            className={`terminal-item terminal-scale terminal-scale-${scaleLabel.toLowerCase()}`}
          >
            Scale: <b>{scaleLabel}</b>
          </span>
          <span className="terminal-item terminal-source">{sourceLabel}</span>
          <span className="terminal-item terminal-source">
            Voice: {voiceLabel(voiceLang)} · ENGINE {voiceEngine()}
          </span>
          <button
            type="button"
            className={`alert-toggle ${alertsOn ? 'on' : 'off'}`}
            aria-pressed={alertsOn}
            title={
              alertsOn
                ? 'Weight alerts on — rings continuously while under or over target'
                : 'Weight alerts muted — turn the tones back on'
            }
            onClick={() => {
              primeAlertAudio();
              setAlertsOn(toggleAlertsEnabled());
            }}
          >
            {alertsOn ? '🔔 ALERTS ON' : '🔕 ALERTS MUTED'}
          </button>
        </span>
        {onCancel && (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={onCancel}
          >
            CANCEL WEIGHING
          </button>
        )}
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
            {cart.map((item: CartItem, index: number) => (
              <div
                key={item.uid}
                className={`queue-row ${item.status}${index === activeIndex ? ' current' : ''}`}
                aria-current={index === activeIndex ? 'step' : undefined}
              >
                <span className="num">{String(index + 1).padStart(2, '0')}</span>
                <span className="queue-item">
                  <span className="queue-item-en">{item.name}</span>
                  <span className="queue-item-local">{localizedName(item, voiceLang)}</span>
                </span>
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
            <div className="current-item-local">{localizedName(activeItem, voiceLang)}</div>
            <div className="current-item-required">
              Required Weight: {fmtWeight(activeItem.required)}
              <button
                type="button"
                className="speaker-btn"
                onClick={() => speakItem(activeItem, voiceLang)}
                aria-label={`Replay item name ${activeItem.name}`}
                title="Replay item name"
              >
                🔊
              </button>
            </div>
          </div>

          <div className="scale-wrap">
            <Scale
              value={current}
              live={isLive}
              liveStable={live?.stable ?? null}
            />
          </div>
        </div>

        <aside className="panel input-panel">
          <div className="panel-title">
            {isLive ? 'LIVE WEIGHT READOUT' : 'WEIGHT INPUT'}
          </div>

          <div className="metric">
            <div className="metric-label">Required Weight</div>
            <div className="metric-value">{fmtWeight(activeItem.required)}</div>
          </div>

          {isLive ? (
            <div className="metric metric-input metric-device">
              <div className="metric-label">Current Weight (Live Scale)</div>
              <div className="live-reading">
                <span
                  className={`live-reading-value ${connected ? '' : 'muted'}`}
                >
                  {current == null ? '—.———' : fmtWeightNoUnit(current)}
                </span>
                <span className="unit">kg</span>
                {connected && live?.stable ? (
                  <span className="live-stable-badge">STABLE</span>
                ) : null}
              </div>
              <div className="metric-hint">
                {connected
                  ? `Reading from YH-T7E over RS232 (${device?.port} @ ${device?.baudRate} baud)`
                  : `Waiting for ${device?.port || 'the scale'}…`}
              </div>
              {offline && (
                <div className="device-error">
                  {device?.message || 'The serial scale is offline.'} Select the USB
                  adapter in the header, or switch back to SIMULATION mode.
                </div>
              )}
              {noReading && (
                <div className="device-error">
                  {(device?.bytesReceived ?? 0) > 0
                    ? `Port is open and ${device?.bytesReceived ?? 0} bytes have arrived, but none are valid YH-T7E weight frames.`
                    : 'Port is open but the scale has sent no data at all.'}{' '}
                  Check the RS232 cable (TX/RX swapped, or a TTL cable instead of
                  RS232) and the baud rate.
                </div>
              )}
            </div>
          ) : (
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
                  value={reading ?? ''}
                  onChange={(event) => handleReading(event.target.value)}
                  onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                    if (event.key === 'Enter') {
                      handleReading(event.currentTarget.value);
                      if (nextEnabled) handleNext();
                    }
                  }}
                />
                <span className="unit">kg</span>
              </div>
              <div className="metric-hint">Simulated scale reading</div>
            </div>
          )}

          <div className="metric">
            <div className="metric-label">Difference</div>
            <div className={`metric-value diff-${diffZone}`}>
              {status.difference == null ? '—' : fmtSignedDiff(status.difference)}
            </div>
          </div>

          {offline ? (
            <div className="status-box status-device">
              <div className="status-title">DEVICE OFFLINE</div>
              <div className="status-detail">
                {device?.message || 'Waiting for the scale to connect…'}
              </div>
            </div>
          ) : (
            <div className={`status-box status-${status.type}`}>
              <div className="status-title">{status.title}</div>
              <div className="status-detail">{status.detail}</div>
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            disabled={!nextEnabled || offline}
            onClick={handleNext}
          >
            NEXT ITEM
          </button>
          {!nextEnabled && nextBlockedReason && !offline && (
            <div className="metric-hint next-blocked">{nextBlockedReason}</div>
          )}
        </aside>
      </div>
    </section>
  );
}
