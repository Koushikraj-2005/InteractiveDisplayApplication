import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { fmtWeight } from '../lib/weights.js';

function fmtStamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function downloadCSV(filename, lines) {
  const escape = (v) => {
    let s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const csv = lines
    .map((line) => (Array.isArray(line) ? line.map(escape).join(',') : String(line)))
    .join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function buildOverviewDoc(o) {
  const months = o.series;
  const years = [...new Set(months.map((e) => e.month.slice(0, 4)))];
  const monthLabel = (m) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  const period = `${years[0] || '—'} – ${monthLabel(months[months.length - 1]?.month || '')}`;
  return {
    code: 'OVR',
    title: 'Production Overview Report',
    subtitle: 'Last 12 months production summary',
    period,
    summary: [
      { label: 'Total Bills', value: String(o.totals.bills) },
      { label: 'Total Items Weighed', value: String(o.totals.items) },
      { label: 'Total Weight', value: fmtWeight(o.totals.totalKg) },
    ],
    sections: [
      {
        heading: 'MONTH-WISE PRODUCTION — LAST 12 MONTHS',
        head: ['Month', 'Bills', 'Items', 'Total Weight'],
        align: ['l', 'r', 'r', 'r'],
        body: months.map((e) => [monthLabel(e.month), String(e.bills), String(e.items), fmtWeight(e.totalKg)]),
        totals: ['Grand Total', String(o.totals.bills), String(o.totals.items), fmtWeight(o.totals.totalKg)],
      },
    ],
    csvFilename: 'naveen-farms-overview.csv',
    csvLines: [
      ['Month', 'Bills', 'Items', 'Total Weight (kg)'],
      ...months.map((e) => [monthLabel(e.month), e.bills, e.items, e.totalKg.toFixed(3)]),
      [],
      ['Grand Total', o.totals.bills, o.totals.items, o.totals.totalKg.toFixed(3)],
    ],
  };
}

function buildMonthlyDoc(m, yy, mm) {
  const label = `${MONTH_NAMES[mm - 1].toUpperCase()} ${yy}`;
  const itemTotals = m.perItem.reduce((s, e) => ({ times: s.times + e.times, kg: s.kg + e.totalKg }), { times: 0, kg: 0 });
  const formulaTotals = m.perFormula.reduce((s, e) => ({ bills: s.bills + e.bills, kg: s.kg + e.totalKg }), { bills: 0, kg: 0 });
  return {
    code: 'MON',
    title: 'Monthly Production Report',
    subtitle: 'Item and formula breakdown',
    period: label,
    summary: [
      { label: 'Bills', value: String(m.summary.bills) },
      { label: 'Items Weighed', value: String(m.summary.items) },
      { label: 'Total Weight', value: fmtWeight(m.summary.totalKg) },
    ],
    sections: [
      {
        heading: `ITEM BREAKDOWN — ${label}`,
        head: ['Item', 'Times Weighed', 'Total Weight'],
        align: ['l', 'r', 'r'],
        body: m.perItem.map((e) => [e.itemName, String(e.times), fmtWeight(e.totalKg)]),
        totals: ['TOTAL', String(itemTotals.times), fmtWeight(itemTotals.kg)],
        note: m.perItem.length === 0 ? 'No items were weighed during this period.' : null,
      },
      {
        heading: `FORMULA BREAKDOWN — ${label}`,
        head: ['Formula', 'Bills', 'Total Weight'],
        align: ['l', 'r', 'r'],
        body: m.perFormula.map((e) => [e.formulaName, String(e.bills), fmtWeight(e.totalKg)]),
        totals: ['TOTAL', String(formulaTotals.bills), fmtWeight(formulaTotals.kg)],
        note: m.perFormula.length === 0 ? 'No formula-based weighings were recorded during this period.' : null,
      },
    ],
    csvFilename: `naveen-farms-monthly-${yy}-${String(mm).padStart(2, '0')}.csv`,
    csvLines: [
      ['Item', 'Times Weighed', 'Total Weight (kg)'],
      ...m.perItem.map((e) => [e.itemName, e.times, e.totalKg.toFixed(3)]),
      ['TOTAL', itemTotals.times, itemTotals.kg.toFixed(3)],
      [],
      ['Formula', 'Bills', 'Total Weight (kg)'],
      ...m.perFormula.map((e) => [e.formulaName, e.bills, e.totalKg.toFixed(3)]),
      ['TOTAL', formulaTotals.bills, formulaTotals.kg.toFixed(3)],
    ],
  };
}

function buildYearlyDoc(y, yr) {
  return {
    code: 'YRL',
    title: 'Yearly Production Report',
    subtitle: 'Month-by-month production summary',
    period: `Calendar year ${yr}`,
    summary: [
      { label: 'Bills', value: String(y.totals.bills) },
      { label: 'Items Weighed', value: String(y.totals.items) },
      { label: 'Total Weight', value: fmtWeight(y.totals.totalKg) },
    ],
    sections: [
      {
        heading: `MONTH-BY-MONTH — ${yr}`,
        head: ['Month', 'Bills', 'Items', 'Total Weight'],
        align: ['l', 'r', 'r', 'r'],
        body: y.months.map((e) => [MONTH_NAMES[Number(e.month.slice(5, 7)) - 1], String(e.bills), String(e.items), fmtWeight(e.totalKg)]),
        totals: [`Year Total ${yr}`, String(y.totals.bills), String(y.totals.items), fmtWeight(y.totals.totalKg)],
      },
    ],
    csvFilename: `naveen-farms-yearly-${yr}.csv`,
    csvLines: [
      ['Month', 'Bills', 'Items', 'Total Weight (kg)'],
      ...y.months.map((e) => [MONTH_NAMES[Number(e.month.slice(5, 7)) - 1], e.bills, e.items, e.totalKg.toFixed(3)]),
      [],
      [`Year Total ${yr}`, y.totals.bills, y.totals.items, y.totals.totalKg.toFixed(3)],
    ],
  };
}

function PrintReport({ doc, onClose }) {
  const [generatedOn] = useState(() => new Date());
  const handlePrint = () => {
    try {
      window.print();
    } catch (err) {
      console.error('print failed', err);
    }
  };
  return createPortal(
    <div className="print-overlay" role="dialog" aria-modal="true" aria-label={doc.title}>
      <div className="print-toolbar">
        <div className="print-toolbar-info">
          <span className="print-toolbar-title">{doc.title}</span>
          <span className="print-toolbar-sub">{doc.subtitle} — {doc.period}</span>
        </div>
        <div className="print-toolbar-actions">
          <button className="btn btn-primary" type="button" onClick={handlePrint}>Print / Save PDF</button>
          <button className="btn btn-secondary" type="button" onClick={() => downloadCSV(doc.csvFilename, doc.csvLines)}>Download CSV</button>
          <button className="btn btn-secondary" type="button" onClick={onClose}>Done</button>
        </div>
      </div>

      <div className="print-report">
        <header className="print-header">
          <div className="print-company">
            <div className="print-company-mark">NF</div>
            <div>
              <div className="print-company-name">Naveen Farms</div>
              <div className="print-company-sub">Industrial Weighing &amp; Packing Solutions</div>
            </div>
          </div>
          <div className="print-docno">DOC-{doc.code}</div>
        </header>

        <div className="print-titleblock">
          <div>
            <h1 className="print-report-title">{doc.title}</h1>
            <div className="print-report-sub">{doc.subtitle}</div>
          </div>
          <div className="print-generated">
            Generated: {fmtStamp(generatedOn)}
            <div>Period: {doc.period}</div>
          </div>
        </div>

        <div className="print-summary">
          {doc.summary.map((s) => (
            <div className="print-summary-box" key={s.label}>
              <div className="print-summary-label">{s.label}</div>
              <div className="print-summary-value">{s.value}</div>
            </div>
          ))}
        </div>

        {doc.sections.map((sec) => (
          <section className="print-section" key={sec.heading}>
            <div className="print-section-title">{sec.heading}</div>
            <table className="print-table">
              <thead>
                <tr>{sec.head.map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {sec.body.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className={sec.align?.[j] === 'r' ? 'num' : undefined}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {sec.totals ? (
                <tfoot>
                  <tr>
                    {sec.totals.map((cell, j) => (
                      <td key={j} className={sec.align?.[j] === 'r' ? 'num' : undefined}>{cell}</td>
                    ))}
                  </tr>
                </tfoot>
              ) : null}
            </table>
            {sec.note ? <div className="print-section-note">{sec.note}</div> : null}
          </section>
        ))}

        <footer className="print-footer">
          <div className="print-signatures">
            <div className="print-signature">
              <div className="print-signature-line" />
              <span>Prepared by</span>
            </div>
            <div className="print-signature">
              <div className="print-signature-line" />
              <span>Checked by</span>
            </div>
            <div className="print-signature">
              <div className="print-signature-line" />
              <span>Authorized by</span>
            </div>
          </div>
          <div className="print-footer-note">Naveen Farms — Plant Weighbridge Records · All weights in kilograms, rounded to 3 decimals</div>
        </footer>
      </div>
    </div>,
    document.body
  );
}

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
  const [printDoc, setPrintDoc] = useState(null);

  const loadOverview = async () => {
    setOverviewLoading(true);
    setOverviewError('');
    try {
      const data = await api.getOverview();
      if (!data || !Array.isArray(data.series)) throw new Error('Unexpected report data');
      setOverview(data);
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

      {overviewError && (
        <div className="error-banner">
          Could not load reports: {overviewError}{' '}
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadOverview}>
            RETRY
          </button>
        </div>
      )}

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
          {overview && (
            <div className="report-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setPrintDoc(buildOverviewDoc(overview))}>
                Download PDF
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  const doc = buildOverviewDoc(overview);
                  downloadCSV(doc.csvFilename, doc.csvLines);
                }}
              >
                Download CSV
              </button>
            </div>
          )}
          <div className="stat-cards">
            <StatCard label="Total Bills" value={overTotals.bills} />
            <StatCard label="Total Items Weighed" value={overTotals.items} />
            <StatCard label="Total Weight" value={overTotals.totalKg} unit="kg" />
          </div>
          <div className="panel">
            <div className="panel-title">LAST 12 MONTHS</div>
            {overviewLoading ? (
              <div className="panel-placeholder">Loading…</div>
            ) : overviewError && !overview ? (
              <div className="panel-placeholder error-text">
                {overviewError}{' '}
                <button type="button" className="btn btn-secondary btn-sm" onClick={loadOverview}>
                  RETRY
                </button>
              </div>
            ) : !overview ? (
              <div className="panel-placeholder">Loading report…</div>
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
          {monthly && (
            <div className="report-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setPrintDoc(buildMonthlyDoc(monthly, selYear, selMonth))}>
                Download PDF
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  const doc = buildMonthlyDoc(monthly, selYear, selMonth);
                  downloadCSV(doc.csvFilename, doc.csvLines);
                }}
              >
                Download CSV
              </button>
            </div>
          )}
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
              <div className="panel-placeholder error-text">
                {monthlyError}{' '}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => loadMonthly(selYear, selMonth)}
                >
                  RETRY
                </button>
              </div>
            ) : !monthly ? (
              <div className="panel-placeholder">Loading report…</div>
            ) : monthly.perItem.length === 0 ? (
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

          <div className="panel">
            <div className="panel-title">
              FORMULA BREAKDOWN — {MONTH_NAMES[selMonth - 1].toUpperCase()} {selYear}
            </div>
            {monthlyLoading ? (
              <div className="panel-placeholder">Loading…</div>
            ) : monthlyError ? (
              <div className="panel-placeholder error-text">
                {monthlyError}{' '}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => loadMonthly(selYear, selMonth)}
                >
                  RETRY
                </button>
              </div>
            ) : !monthly ? (
              <div className="panel-placeholder">Loading report…</div>
            ) : monthly.perFormula.length === 0 ? (
              <div className="panel-placeholder">No formula-based weighings this month.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Formula</th>
                    <th className="text-right">Bills</th>
                    <th className="text-right">Total Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.perFormula.map((entry) => (
                    <tr key={entry.formulaName}>
                      <td className="item-name">{entry.formulaName}</td>
                      <td className="num text-right">{entry.bills}</td>
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
          {yearly && (
            <div className="report-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setPrintDoc(buildYearlyDoc(yearly, selYear))}>
                Download PDF
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  const doc = buildYearlyDoc(yearly, selYear);
                  downloadCSV(doc.csvFilename, doc.csvLines);
                }}
              >
                Download CSV
              </button>
            </div>
          )}
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
              <div className="panel-placeholder error-text">
                {yearlyError}{' '}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => loadYearly(selYear)}
                >
                  RETRY
                </button>
              </div>
            ) : !yearly ? (
              <div className="panel-placeholder">Loading report…</div>
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

      {printDoc ? <PrintReport doc={printDoc} onClose={() => setPrintDoc(null)} /> : null}
    </section>
  );
}