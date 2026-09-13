import { fmtDateTime, fmtWeight } from '../lib/weights.js';

export function CompletionScreen({ cart, savedBill, saving, saveError, onStartNew, onPrint }) {
  const batchLabel = savedBill
    ? savedBill.batchNo
    : saving
      ? 'SAVING RECORD…'
      : `WEIGH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const recipeNames = new Set(
    cart.map((item) => item.recipeName).filter((name) => Boolean(name)),
  );
  const recipeLabel = recipeNames.size === 1 ? [...recipeNames][0] : null;

  return (
    <section className="stage">
      <div className="completion-wrap">
        <div className="panel print-area">
          <div className="completion-head">
            <div className="completion-title">WEIGHING COMPLETE</div>
            <div className="completion-sub">
              Batch: {batchLabel}
              {savedBill ? ` · Recorded ${fmtDateTime(savedBill.weighedAt)}` : ''}
            </div>
            {recipeLabel && (
              <div className="recipe-label">Recipe: {recipeLabel}</div>
            )}
            {(saving || saveError) && (
              <div className={`save-state ${saveError ? 'save-error' : 'save-saved'}`}>
                {saveError
                  ? `Not stored: ${saveError}`
                  : 'Storing this weighing in the records…'}
              </div>
            )}
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th className="col-no">No.</th>
                <th>Item</th>
                <th className="col-w">Required Weight</th>
                <th className="col-status">Status</th>
              </tr>
            </thead>
            <tbody>
              {cart.map((item, index) => (
                <tr key={item.uid}>
                  <td className="num col-no">{String(index + 1).padStart(2, '0')}</td>
                  <td>{item.name}</td>
                  <td className="num col-w">{fmtWeight(item.required)}</td>
                  <td className="col-status">
                    <span className="chip chip-accepted">✓ Accepted</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="completion-total">
            <span>Total Items: {cart.length}</span>
            <span>
              Total Weight:{' '}
              <b>{fmtWeight(cart.reduce((sum, item) => sum + item.required, 0))}</b>
            </span>
          </div>
        </div>

        <div className="completion-actions no-print">
          <button type="button" className="btn btn-secondary" onClick={onPrint}>
            PRINT REPORT
          </button>
          <button type="button" className="btn btn-primary btn-lg" onClick={onStartNew}>
            START NEW WEIGHING
          </button>
        </div>
      </div>
    </section>
  );
}