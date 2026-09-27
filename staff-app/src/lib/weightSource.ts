import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ScaleReading,
  ScaleStatus,
  ScaleStatusResponse,
  SerialPortInfo,
} from '../../../shared/scale.ts';
import { API_BASE, api } from '../api.ts';
import { parseWeight } from './weights.ts';

const STREAM_URL = `${API_BASE}/scale/stream`;
const MODE_KEY = 'koushi-weight-mode';

export const MODE_SIMULATION = 'simulation';
export const MODE_WEIGHING = 'weighing';

export type WeightMode = typeof MODE_SIMULATION | typeof MODE_WEIGHING;

/** The device state the UI renders, flattened for convenience. */
export interface DeviceState {
  connected: boolean;
  status: ScaleStatus;
  port: string | null;
  baudRate: number;
  message: string | null;
  since: string | null;
  bytesReceived: number;
}

export interface ConnectOptions {
  port?: string;
  baudRate?: number;
}

const IDLE_DEVICE: DeviceState = {
  connected: false,
  status: 'stopped',
  port: null,
  baudRate: 0,
  message: null,
  since: null,
  bytesReceived: 0,
};

function readInitialMode(): WeightMode {
  if (typeof window === 'undefined') return MODE_SIMULATION;
  try {
    return window.localStorage.getItem(MODE_KEY) === MODE_WEIGHING
      ? MODE_WEIGHING
      : MODE_SIMULATION;
  } catch {
    return MODE_SIMULATION;
  }
}

const fromStatus = (status: ScaleStatusResponse | null | undefined): DeviceState => ({
  ...IDLE_DEVICE,
  ...status,
  connected: status?.status === 'connected',
});

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Single source of the current weight.
 *
 * simulation -> the operator types the reading into the keypad
 * weighing    -> the reading is streamed from the serial scale over SSE
 *
 * Also owns the device connection: port discovery, connect/disconnect and the
 * live status pushed by the server.
 */
export function useWeightSource() {
  const [mode, setModeState] = useState<WeightMode>(readInitialMode);
  const [raw, setRaw] = useState('');
  const [live, setLive] = useState<ScaleReading | null>(null);
  const [device, setDevice] = useState<DeviceState>(IDLE_DEVICE);
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [baudRates, setBaudRates] = useState<number[]>([9600]);
  const [portsLoading, setPortsLoading] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceError, setDeviceError] = useState('');

  const liveRef = useRef<ScaleReading | null>(null);
  liveRef.current = live;

  const setMode = useCallback((next: WeightMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      // storage unavailable (private mode) — the toggle still works for this session
    }
  }, []);

  const refreshPorts = useCallback(async () => {
    setPortsLoading(true);
    try {
      const data = await api.getScalePorts();
      setPorts(Array.isArray(data?.ports) ? data.ports : []);
      if (Array.isArray(data?.baudRates) && data.baudRates.length) {
        setBaudRates(data.baudRates);
      }
    } catch (err) {
      setDeviceError(errText(err));
    } finally {
      setPortsLoading(false);
    }
  }, []);

  const connect = useCallback(async ({ port, baudRate }: ConnectOptions = {}) => {
    setDeviceBusy(true);
    setDeviceError('');
    try {
      const status = await api.connectScale({ port, baudRate });
      setDevice(fromStatus(status));
      return true;
    } catch (err) {
      setDeviceError(errText(err));
      return false;
    } finally {
      setDeviceBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setDeviceBusy(true);
    setDeviceError('');
    try {
      const status = await api.disconnectScale();
      setDevice(fromStatus(status));
      setLive(null);
    } catch (err) {
      setDeviceError(errText(err));
    } finally {
      setDeviceBusy(false);
    }
  }, []);

  // Live stream, only while the operator is actually using the device.
  useEffect(() => {
    if (mode !== MODE_WEIGHING) return undefined;
    let closed = false;
    const source = new EventSource(STREAM_URL);

    const onStatus = (event: MessageEvent) => {
      let next: ScaleStatusResponse | null = null;
      try {
        next = JSON.parse(event.data) as ScaleStatusResponse;
      } catch {
        return;
      }
      if (closed) return;
      setDevice(fromStatus(next));
      // A dropped connection must not leave a stale weight looking valid.
      if (next?.status !== 'connected') setLive(null);
    };

    const onReading = (event: MessageEvent) => {
      let next: ScaleReading | null = null;
      try {
        next = JSON.parse(event.data) as ScaleReading;
      } catch {
        return;
      }
      if (closed || !Number.isFinite(next?.weight)) return;
      setLive(next);
    };

    source.addEventListener('status', onStatus as EventListener);
    source.addEventListener('reading', onReading as EventListener);
    source.onerror = () => {
      if (closed) return;
      setDevice((d) => ({
        ...d,
        connected: false,
        status: 'stopped',
        message: 'Lost connection to the scale service',
      }));
    };

    return () => {
      closed = true;
      source.removeEventListener('status', onStatus as EventListener);
      source.removeEventListener('reading', onReading as EventListener);
      source.close();
    };
  }, [mode]);

  // Discover the attached adapters as soon as device mode is in play.
  useEffect(() => {
    if (mode !== MODE_WEIGHING) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await api.getScaleStatus();
        if (!cancelled) setDevice(fromStatus(status));
      } catch {
        // the stream below reports connection problems
      }
    })();
    refreshPorts();
  }, [mode, refreshPorts]);

  const getReading = useCallback((): number | null => {
    if (mode === MODE_WEIGHING) return liveRef.current?.weight ?? null;
    return parseWeight(raw);
  }, [mode, raw]);

  return {
    mode,
    setMode,
    raw,
    setRaw,
    live,
    device,
    getReading,
    ports,
    baudRates,
    portsLoading,
    refreshPorts,
    deviceBusy,
    deviceError,
    connect,
    disconnect,
  };
}
