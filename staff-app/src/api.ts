import { createRequester } from '../../shared/http.ts';
import type { ScalePortsResponse, ScaleStatusResponse } from '../../shared/scale.ts';
import type { Bill, Formula, Item, WeighingLine } from './lib/types.ts';
import { API_BASE } from './lib/config.ts';

export { API_BASE };

const request = createRequester(API_BASE);

export interface WeighingPayload {
  weighedAt: string;
  formulaName: string | null;
  lines: WeighingLine[];
}

export const api = {
  getItems: () => request<Item[]>('/items'),
  getFormulas: () => request<Formula[]>('/formulas'),
  saveWeighing: (payload: WeighingPayload) =>
    request<Bill>('/weighings', { method: 'POST', body: JSON.stringify(payload) }),
  getScalePorts: () => request<ScalePortsResponse>('/scale/ports'),
  getScaleStatus: () => request<ScaleStatusResponse>('/scale/status'),
  connectScale: (payload: { port?: string; baudRate?: number }) =>
    request<ScaleStatusResponse>('/scale/connect', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  disconnectScale: () => request<ScaleStatusResponse>('/scale/disconnect', { method: 'POST' }),
};

export type { WeighingLine };
