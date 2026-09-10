import { fmtWeight } from '../lib/weights.js';

export function ItemSelection({
  items,
  itemsLoading,
  cart,
  selectedItemId,
  reqInput,
  reqError,
  onSelectItem,
  onReqInput,
  onAddToCart,
  onRemove,
  onStart,
}) {
  const selectedItem = items.find((item) => item.id === selectedItemId);

  return (
    <section className="stage">
      <div className="selection-layout">
        <div className="panel">
          <div className="panel-title">ITEM MASTER</div>
          <div className="panel-sub">Select items to be weighed</div>
          <div className="item-list">
            {itemsLoading ? (
              <div className="panel-placeholder">Loading items…</div>
            ) : items.length === 0 ? (
              <div className="panel-placeholder">No items in the master. Add items under ITEM MASTER.</div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`item-row${selectedItemId === item.id ? ' selected' : ''}`}
                  onClick={() => onSelectItem(item.id)}
                >
                  <span className="item-code">{item.code}</span>
                  <span className="item-name">{item.name}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">SELECT ITEM</div>
          {selectedItem ? (
            <div className="select-form">
              <div className="form-field">
                <div className="field-label">Item Name</div>
                <div className="selected-name">{selectedItem.name}</div>
              </div>
              <div className="form-field">
                <div className="field-label">Required Weight</div>
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
          ) : (
            <div className="panel-placeholder">Select an item from the ITEM MASTER.</div>
          )}
        </div>

        <div className="panel weighing-list">
          <div className="panel-title">WEIGHING LIST</div>
          <div className="panel-sub">Items queued for the weighing terminal</div>
          {cart.length === 0 ? (
            <div className="panel-placeholder">No items in the weighing list.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="col-no">No.</th>
                  <th>Item</th>
                  <th className="col-w">Required Weight</th>
                  <th className="col-status">Status</th>
                  <th className="col-x" />
                </tr>
              </thead>
              <tbody>
                {cart.map((item, index) => (
                  <tr key={item.uid}>
                    <td className="num col-no">{String(index + 1).padStart(2, '0')}</td>
                    <td>{item.name}</td>
                    <td className="num col-w">{fmtWeight(item.required)}</td>
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
          <div className="panel-footer">
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