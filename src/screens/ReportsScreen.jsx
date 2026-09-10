import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { fmtWeight } from '../lib/weights.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const TABS = [
  { key: 'overview', label: 'OVERVIEW' },
  { key: 'monthly', label: 'MONTHLY' },
  { key: 'yearly', label: 'YEARLY' },
];

const emptySummary = () => ({ bills: 0, items: 0, totalKg: 0 });

function StatCard({ label, value, unit }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit ? <span className="stat-unit">{unit}</span> : null}
      </div>
    </div>
  );
}

export function ReportsScreen() {
  const now = new Date();
  const [tab, setTab] = useState('overview');

  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');

  const [monthly, setMonthly] = useState(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyError, setMonthlyError] = useState('');

  const [yearly, setYearly] = useState(null);
  const [yearlyLoading, setYearlyLoading] = useState(false);
  const [yearlyError, setYearlyError] = useState('');

  const [selYear, setSelYear] = useState(now.getFullYear());
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1);

  const loadOverview = async () => {
    setOverviewLoading(true);
    setOverviewError('');
    try {
      setOverview(await api.getOverview());
    } catch (err) {
      setOverviewError(err.message);
    } finally {
      setOverviewLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const loadMonthly = async (year, month) => {
    setMonthlyLoading(true);
    setMonthlyError('');
    try {
      setMonthly(await api.getMonthlyReport(year, month));
    } catch (err) {
      setMonthlyError(err.message);
    } finally {
      setMonthlyLoading(false);
    }
  };

  const loadYearly = async (year) => {
    setYearlyLoading(true);
    setYearlyError('');
    try {
      setYearly(await api.getYearlyReport(year));
    } catch (err) {
      setYearlyError(err.message);
    } finally {
      setYearlyLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'monthly') loadMonthly(selYear, selMonth);
  }, [tab, selYear, selMonth]);

  useEffect(() => {
    if (tab === 'yearly') loadYearly(selYear);
  }, [tab, selYear]);

  const years = useMemo(() => {
    const set = new Set([now.getFullYear()]);
    if (overview) {
      for (const entry of overview.series) set.add(Number(entry.month.slice(0, 4)));
    }
    return [...set].sort((a, b) => b - a);
  }, [overview, now]);

  const overTotals = overview?.totals || emptySummary();
  const monthlySummary = monthly?.summary || emptySummary();
  const yearTotals = yearly?.totals || emptySummary();

  return (
    <section className="stage">
      <div className="screen-title">REPORTS</div>
      <div className="screen-sub">Production totals and per-item breakdowns.</div>

      {overviewError && <div className="error-banner">Could not load reports: {overviewError}</div>}

      <div className="report-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`report-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="report-body">
          <div className="stat-cards">
            <StatCard label="Total Bills" value={overTotals.bills} />
            <StatCard label="Total Items Weighed" value={overTotals.items} />
            <StatCard label="Total Weight" value={overTotals.totalKg} unit="kg" />
          </div>
          <div className="panel">
            <div className="panel-title">LAST 12 MONTHS</div>
            {overviewLoading ? (
              <div className="panel-placeholder">Loading…</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="text-right">Bills</th>
                    <th className="text-right">Items</th>
                    <th className="text-right">Total Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.series.map((entry) => (
                    <tr key={entry.month}>
                      <td>
                        {MONTH_NAMES[Number(entry.month.slice(5, 7)) - 1]}{' '}
                        {entry.month.slice(0, 4)}
                      </td>
                      <td className="num text-right">{entry.bills}</td>
                      <td className="num text-right">{entry.items}</td>
                      <td className="num text-right">{fmtWeight(entry.totalKg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'monthly' && (
        <div className="report-body">
          <div className="report-filters">
            <label className="filter-field">
              <span className="filter-label">Year</span>
              <select className="select-input" value={selYear} onChange={(e) => setSelYear(Number(e.target.value))}>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span className="filter-label">Month</span>
              <select className="select-input" value={selMonth} onChange={(e) => setSelMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((m, index) => (
                  <option key={m} value={index + 1}>{m}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="stat-cards">
            <StatCard label="Bills" value={monthlySummary.bills} />
            <StatCard label="Items" value={monthlySummary.items} />
            <StatCard label="Total Weight" value={monthlySummary.totalKg} unit="kg" />
          </div>

          <div className="panel">
            <div className="panel-title">
              ITEM BREAKDOWN — {MONTH_NAMES[selMonth - 1].toUpperCase()} {selYear}
            </div>
            {monthlyLoading ? (
              <div className="panel-placeholder">Loading…</div>
            ) : monthlyError ? (
              <div className="panel-placeholder error-text">{monthlyError}</div>
            ) : monthly?.perItem?.length === 0 ? (
              <div className="panel-placeholder">No weighings recorded for this month.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-right">Times Weighed</th>
                    <th className="text-right">Total Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.perItem.map((entry) => (
                    <tr key={entry.itemName}>
                      <td className="item-name">{entry.itemName}</td>
                      <td className="num text-right">{entry.times}</td>
                      <td className="num text-right">{fmtWeight(entry.totalKg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'yearly' && (
        <div className="report-body">
          <div className="report-filters">
            <label className="filter-field">
              <span className="filter-label">Year</span>
              <select className="select-input" value={selYear} onChange={(e) => setSelYear(Number(e.target.value))}>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="stat-cards">
            <StatCard label="Bills" value={yearTotals.bills} />
            <StatCard label="Items" value={yearTotals.items} />
            <StatCard label="Total Weight" value={yearTotals.totalKg} unit="kg" />
          </div>

          <div className="panel">
            <div className="panel-title">MONTH-BY-MONTH — {selYear}</div>
            {yearlyLoading ? (
              <div className="panel-placeholder">Loading…</div>
            ) : yearlyError ? (
              <div className="panel-placeholder error-text">{yearlyError}</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="text-right">Bills</th>
                    <th className="text-right">Items</th>
                    <th className="text-right">Total Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {yearly.months.map((entry) => (
                    <tr key={entry.month} className={entry.bills === 0 ? 'row-zero' : ''}>
                      <td>{MONTH_NAMES[Number(entry.month.slice(5, 7)) - 1]}</td>
                      <td className="num text-right">{entry.bills}</td>
                      <td className="num text-right">{entry.items}</td>
                      <td className="num text-right">{fmtWeight(entry.totalKg)}</td>
                    </tr>
                  ))}
                  <tr className="row-total">
                    <td>Year Total</td>
                    <td className="num text-right">{yearTotals.bills}</td>
                    <td className="num text-right">{yearTotals.items}</td>
                    <td className="num text-right">{fmtWeight(yearTotals.totalKg)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </section>
  );
}