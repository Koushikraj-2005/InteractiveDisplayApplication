import { useEffect, useState } from 'react';
import type { SerialPortInfo } from '../../../shared/scale.ts';
import type { ConnectOptions, DeviceState } from '../lib/weightSource.ts';

const FALLBACK_BAUD = 9600;

const statusText = (device: DeviceState | null | undefined): string => {
  if (!device) return '';
  if (device.status === 'connected') {
    const rate = device.baudRate ? ` @ ${device.baudRate} baud` : '';
    return `Connected to ${device.port}${rate}`;
  }
  return device.message || 'Not connected';
};

export interface ScaleConnectionProps {
  device: DeviceState;
  ports: SerialPortInfo[];
  baudRates: number[];
  portsLoading: boolean;
  refreshPorts: () => void | Promise<void>;
  deviceBusy: boolean;
  deviceError: string;
  connect: (options?: ConnectOptions) => Promise<boolean>;
  disconnect: () => Promise<void>;
}

/**
 * Scale link controls: which USB adapter / serial port to read from, plus
 * connect, rescan and disconnect. Weighing always reads from the machine, so
 * there is no input source to switch between.
 */
export function ScaleConnection({
  device,
  ports,
  baudRates,
  portsLoading,
  refreshPorts,
  deviceBusy,
  deviceError,
  connect,
  disconnect,
}: ScaleConnectionProps) {
  const [port, setPort] = useState('');
  const [baudRate, setBaudRate] = useState(FALLBACK_BAUD);

  useEffect(() => {
    if (device?.port) setPort(device.port);
  }, [device?.port]);

  useEffect(() => {
    if (device?.baudRate) setBaudRate(device.baudRate);
  }, [device?.baudRate]);

  useEffect(() => {
    if (port || ports.length === 0) return;
    const preferred =
      ports.find((p: SerialPortInfo) => p.isDefault) ||
      ports.find((p: SerialPortInfo) => p.kind === 'usb') ||
      ports[0];
    if (preferred) setPort(preferred.path);
  }, [ports, port]);

  const usbPorts = ports.filter((p) => p.kind === 'usb');
  const uartPorts = ports.filter((p) => p.kind !== 'usb');
  const connected = Boolean(device?.connected);

  return (
    <div className="scale-conn">
      <div className="scale-conn-body">
        <select
          className="scale-port-select"
          value={port}
          onChange={(event) => setPort(event.target.value)}
          aria-label="Serial port"
        >
          {usbPorts.length > 0 && (
            <optgroup label="USB adapters">
              {usbPorts.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.label} ({p.path})
                </option>
              ))}
            </optgroup>
          )}
          {uartPorts.length > 0 && (
            <optgroup label="Serial ports">
              {uartPorts.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.path}
                </option>
              ))}
            </optgroup>
          )}
          {ports.length === 0 && <option value="">No serial ports found</option>}
        </select>

        <select
          className="scale-baud-select"
          value={baudRate}
          onChange={(event) => setBaudRate(Number(event.target.value))}
          aria-label="Baud rate"
        >
          {(baudRates.length ? baudRates : [FALLBACK_BAUD]).map((rate) => (
            <option key={rate} value={rate}>
              {rate}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={refreshPorts}
          disabled={portsLoading || deviceBusy}
          title="Rescan for serial ports"
        >
          {portsLoading ? 'SCANNING…' : 'RESCAN'}
        </button>

        {connected ? (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={disconnect}
            disabled={deviceBusy}
          >
            DISCONNECT
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => connect({ port, baudRate })}
            disabled={deviceBusy || !port}
          >
            {deviceBusy ? 'CONNECTING…' : 'CONNECT'}
          </button>
        )}

        <span className="scale-conn-status">
          {deviceError ? <b className="err">{deviceError}</b> : statusText(device)}
        </span>
      </div>

      <span className="mode-badge">
        {connected ? 'SCALE ONLINE' : 'SCALE OFFLINE'}
        <span className={`mode-dot${connected ? ' on' : ' err'}`} />
      </span>
    </div>
  );
}
