import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDateTime, fmtWeight } from '../lib/weights.js';

export function HistoryScreen() {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setBills(await api.getWeighings());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggle(id) {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    setDetailError('');
    try {
      setDetail(await api.getWeighing(id));
    } catch (err) {
      setDetailError(err.message);
    }
  }

  const renderRows = () => {
    if (bills.length === 0) {
      return (
        <div className="panel-placeholder">
          No weighing records yet. Complete a weighing from the terminal to store it here.
        </div>
      );
    }
    return (
      <div className="history-list">
        {bills.map((bill) => {
          const opened = openId === bill.id;
          return (
            <div key={bill.id} className={`history-row${opened ? ' open' : ''}`}>
              <button
                type="button"
                className="history-head"
                onClick={() => toggle(bill.id)}
              >
                <span className="num batch-no">{bill.batchNo}</span>
                <span className="history-date">{fmtDateTime(bill.weighedAt)}</span>
                <span className="num history-items">{bill.itemCount} items</span>
                <span className="num history-weight">{fmtWeight(bill.totalWeight)}</span>
                <span className="history-expand">{opened ? '−' : '+'}</span>
              </button>
              {opened && (
                <div className="history-detail">
                  {detailError && <div className="error-text">{detailError}</div>}
                  {detail && (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th className="col-no">No.</th>
                          <th>Item</th>
                          <th className="col-w">Weight</th>
                          <th className="col-status">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.lines.map((line, index) => (
                          <tr key={line.id}>
                            <td className="num col-no">{String(index + 1).padStart(2, '0')}</td>
                            <td>{line.itemName}</td>
                            <td className="num col-w">{fmtWeight(line.requiredWeight)}</td>
                            <td className="col-status">
                              <span className="chip chip-accepted">Accepted</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section className="stage">
      <div className="screen-title">
        WEIGHING HISTORY
        <button type="button" className="btn btn-secondary refresh-btn" onClick={load}>
          REFRESH
        </button>
      </div>
      <div className="screen-sub">All stored bills, newest first. Click a batch to view its line items.</div>

      {error && <div className="error-banner">Could not load history: {error}</div>}

      <div className="panel">
        <div className="panel-title">STORED BILLS ({bills.length})</div>
        {loading ? <div className="panel-placeholder">Loading records…</div> : renderRows()}
      </div>
    </section>
  );
}