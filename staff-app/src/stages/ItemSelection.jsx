import { fmtWeight } from '../lib/weights.js';

export function ItemSelection({
  items,
  itemsLoading,
  formulas,
  cart,
  selectedItemId,
  selectedFormulaId,
  reqInput,
  reqError,
  targetError,
  onSelectItem,
  onSelectFormula,
  onReqInput,
  onAddToCart,
  onRemove,
  onUpdateTarget,
  onStart,
  onLoadFormula,
  onCancel,
}) {
  const selectedItem = items.find((item) => item.id === selectedItemId);
  const selectedFormula = formulas.find((formula) => formula.id === selectedFormulaId);

  const selectItem = (id) => {
    onSelectItem(id);
    onReqInput('');
  };
  const selectFormula = (formula) => {
    onSelectFormula(formula.id);
    onReqInput('');
  };

  const formulaContent = selectedFormula && (
    <div className="select-form">
      <div className="formula-summary">
        <div className="formula-summary-name">{selectedFormula.name}</div>
        <div className="formula-summary-meta">
          {selectedFormula.lines.length} ingredients · {fmtWeight(selectedFormula.totalWeight)}
        </div>
      </div>
      <div className="formula-builder-list">
        {selectedFormula.lines.map((line, index) => (
          <div key={`${line.itemId}-${index}`} className="formula-builder-row">
            <span className="formula-builder-name">{line.itemName}</span>
            <span className="num formula-builder-weight">{fmtWeight(line.requiredWeight)}</span>
          </div>
        ))}
      </div>
      <div className="formula-master-note">
        Using this formula replaces the current weighing list with its ingredients.
      </div>
      <button
        type="button"
        className="btn btn-primary btn-block"
        onClick={() => onLoadFormula(selectedFormula)}
      >
        LOAD FORMULA INTO WEIGHING LIST
      </button>
    </div>
  );

  const itemContent = selectedItem && (
    <div className="select-form">
      <div className="form-field">
        <div className="field-label">Item Name</div>
        <div className="selected-name">{selectedItem.name}</div>
      </div>
      <div className="form-field">
        <div className="field-label">Required Weight (target)</div>
        <div className="input-row">
          <input
            id="req-weight"
            className="weight-input"
            type="number"
            step="0.001"
            min="0"
            placeholder="0.000"
            inputMode="decimal"
            value={reqInput}
            onChange={(event) => onReqInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onAddToCart();
            }}
          />
          <span className="unit">kg</span>
        </div>
        {reqError && <div className="error-text">{reqError}</div>}
      </div>
      <button type="button" className="btn btn-primary btn-block" onClick={onAddToCart}>
        ADD TO WEIGHING LIST
      </button>
    </div>
  );

  return (
    <section className="stage">
      <div className="selection-layout">
        <div className="left-rail">
          <div className="panel">
            <div className="panel-title">FORMULA CATALOG</div>
            <div className="panel-sub">Load a pre-set combination</div>
            <div className="item-list">
              {formulas.length === 0 ? (
                <div className="panel-placeholder">
                  No formulas yet. Create them in the admin portal.
                </div>
              ) : (
                formulas.map((formula) => (
                  <button
                    key={formula.id}
                    type="button"
                    className={`item-row${selectedFormulaId === formula.id ? ' selected' : ''}`}
                    onClick={() => selectFormula(formula)}
                  >
                    <span className="item-name">{formula.name}</span>
                    <span className="item-code">{formula.lines.length} ing.</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">ITEM MASTER</div>
            <div className="panel-sub">Select single items to be weighed</div>
            <div className="item-list">
              {itemsLoading ? (
                <div className="panel-placeholder">Loading items…</div>
              ) : items.length === 0 ? (
                <div className="panel-placeholder">
                  No items in the master. Add items in the admin portal.
                </div>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`item-row${selectedItemId === item.id ? ' selected' : ''}`}
                    onClick={() => selectItem(item.id)}
                  >
                    <span className="item-code">{item.code}</span>
                    <span className="item-name">{item.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">
            {selectedFormula ? 'SELECTED FORMULA' : 'SELECT ITEM'}
          </div>
          {selectedFormula
            ? formulaContent
            : selectedItem
              ? itemContent
              : (
                <div className="panel-placeholder">
                  Pick a formula from the catalog or an item from the master to begin building the
                  weighing list.
                </div>
              )}
        </div>

        <div className="panel weighing-list">
          <div className="panel-title">WEIGHING LIST</div>
          <div className="panel-sub">Set or change each target, then start weighing</div>
          {cart.length === 0 ? (
            <div className="panel-placeholder">No items in the weighing list.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="col-no">No.</th>
                  <th>Item</th>
                  <th className="col-w">Target Weight</th>
                  <th className="col-status">Status</th>
                  <th className="col-x" />
                </tr>
              </thead>
              <tbody>
                {cart.map((item, index) => (
                  <tr key={item.uid}>
                    <td className="num col-no">{String(index + 1).padStart(2, '0')}</td>
                    <td>
                      {item.name}
                      {item.formulaName && (
                        <div className="cart-formula-tag">{item.formulaName}</div>
                      )}
                    </td>
                    <td className="num col-w">
                      <span className="target-edit">
                        <input
                          className="weight-input target-input"
                          type="number"
                          step="0.001"
                          min="0"
                          inputMode="decimal"
                          defaultValue={item.required}
                          onChange={(event) => onUpdateTarget(item.uid, event.target.value)}
                        />
                        <span className="target-unit">kg</span>
                      </span>
                    </td>
                    <td className="col-status">
                      <span className="chip chip-pending">Pending</span>
                    </td>
                    <td className="col-x">
                      <button type="button" className="remove-btn" onClick={() => onRemove(item.uid)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {targetError && <div className="error-text panel-actions">{targetError}</div>}
          <div className="panel-footer">
            {onCancel && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onCancel}
              >
                BACK TO MENU
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={cart.length === 0}
              onClick={onStart}
            >
              START WEIGHING
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}