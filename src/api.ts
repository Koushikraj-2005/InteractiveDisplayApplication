import { createRequester } from '../shared/http.ts';
import type {
  Bill,
  BillDetail,
  Formula,
  Item,
  MonthlyReport,
  OverviewReport,
  WeighingLine,
  YearlyReport,
} from './lib/types.ts';
import { serverBase } from './lib/serverAddress.ts';

// The base is read on every call: in the Android build the server address is
// configurable at runtime, so it must not be frozen at import time.
const request = createRequester(() => `${serverBase()}/api`);

export interface NewItemPayload {
  name: string;
  name_hi?: string;
  name_bn?: string;
  name_ta?: string;
}

/** The server resolves item_name from itemId, so the name is not sent. */
export interface FormulaPayload {
  name: string;
  lines: Array<Pick<WeighingLine, 'itemId' | 'requiredWeight'>>;
}

export interface WeighingPayload {
  weighedAt: string;
  formulaName: string | null;
  lines: WeighingLine[];
}

export const api = {
  getItems: () => request<Item[]>('/items'),
  createItem: (payload: NewItemPayload) =>
    request<Item>('/items', { method: 'POST', body: JSON.stringify(payload) }),
  deleteItem: (id: number) => request<{ ok: boolean }>(`/items/${id}`, { method: 'DELETE' }),
  saveWeighing: (payload: WeighingPayload) =>
    request<Bill>('/weighings', { method: 'POST', body: JSON.stringify(payload) }),
  getWeighings: () => request<Bill[]>('/weighings'),
  getWeighing: (id: number) => request<BillDetail>(`/weighings/${id}`),
  getFormulas: () => request<Formula[]>('/formulas'),
  createFormula: (payload: FormulaPayload) =>
    request<Formula>('/formulas', { method: 'POST', body: JSON.stringify(payload) }),
  updateFormula: (id: number, payload: FormulaPayload) =>
    request<Formula>(`/formulas/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteFormula: (id: number) => request<{ ok: boolean }>(`/formulas/${id}`, { method: 'DELETE' }),
  getOverview: () => request<OverviewReport>('/reports/overview'),
  getMonthlyReport: (year: number, month: number) =>
    request<MonthlyReport>(`/reports/monthly?year=${year}&month=${month}`),
  getYearlyReport: (year: number) => request<YearlyReport>(`/reports/yearly?year=${year}`),
  getScalePorts: () => request<import('../shared/scale.ts').ScalePortsResponse>('/scale/ports'),
  getScaleStatus: () => request<import('../shared/scale.ts').ScaleStatusResponse>('/scale/status'),
  connectScale: (payload: { port?: string; baudRate?: number }) =>
    request<import('../shared/scale.ts').ScaleStatusResponse>('/scale/connect', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  disconnectScale: () =>
    request<import('../shared/scale.ts').ScaleStatusResponse>('/scale/disconnect', {
      method: 'POST',
    }),
};
