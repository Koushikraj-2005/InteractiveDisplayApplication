import { useState } from 'react';
import { api } from '../api.js';
import { fmtWeight } from '../lib/weights.js';

const MAX_NAME_LENGTH = 60;

export function FormulasScreen({ items, formulas, formulasError, onFormulasChanged }) {
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState('');
  const [lines, setLines] = useState([]);
  const [selItemId, setSelItemId] = useState('');
  const [ingWeight, setIngWeight] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);

  const itemById = (id) => items.find((item) => item.id === Number(id));

  function resetForm() {
    setEditingId(null);
    setName('');
    setLines([]);
    setSelItemId('');
    setIngWeight('');
    setError('');
    setConfirmingId(null);
  }

  function startEdit(formula) {
    setEditingId(formula.id);
    setName(formula.name);
    setLines(
      formula.lines.map((line) => ({
        itemId: line.itemId,
        itemName: line.itemName,
        requiredWeight: line.requiredWeight,
      })),
    );
    setSelItemId('');
    setIngWeight('');
    setError('');
    setConfirmingId(null);
  }

  function addIngredient() {
    const item = itemById(selItemId);
    const weight = Number(ingWeight);
    if (!item) {
      setError('Select an ingredient from the list first');
      return;
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      setError('Enter a weight above zero, e.g. 0.250');
      return;
    }
    if (lines.some((line) => line.itemId === item.id)) {
      setError(`${item.name} is already in this formula`);
      return;
    }
    setLines((prev) => [
      ...prev,
      { itemId: item.id, itemName: item.name, requiredWeight: Math.round(weight * 1000) / 1000 },
    ]);
    setSelItemId('');
    setIngWeight('');
    setError('');
  }

  function removeIngredient(index) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function saveFormula() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Formula name is required');
      return;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setError(`Formula name must be ${MAX_NAME_LENGTH} characters or fewer`);
      return;
    }
    if (lines.length === 0) {
      setError('Add at least one ingredient to the formula');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      name: trimmed,
      lines: lines.map((line) => ({ itemId: line.itemId, requiredWeight: line.requiredWeight })),
    };
    try {
      if (editingId != null) {
        await api.updateFormula(editingId, payload);
      } else {
        await api.createFormula(payload);
      }
      resetForm();
      onFormulasChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(formula) {
    if (confirmingId !== formula.id) {
      setConfirmingId(formula.id);
      window.setTimeout(() => {
        setConfirmingId((current) => (current === formula.id ? null : current));
      }, 3000);
      return;
    }
    setConfirmingId(null);
    try {
      await api.deleteFormula(formula.id);
      if (editingId === formula.id) resetForm();
      onFormulasChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  const totalWeight = lines.reduce((sum, line) => sum + line.requiredWeight, 0);

  return (
    <section className="stage">
      <div className="screen-title">
        {editingId != null ? `EDIT FORMULA` : 'FORMULAS'}
      </div>
      <div className="screen-sub">
        A formula is a pre-set combination of ingredients with their exact weighing targets.
        Load a formula at the weighing terminal to start weighing it immediately.
      </div>

      {error && <div className="error-banner">{error}</div>}
      {formulasError && (
        <div className="error-banner">
          Could not load formulas: {formulasError}{' '}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onFormulasChanged}>
            RETRY
          </button>
        </div>
      )}

      <div className="items-layout">
        <div className="panel items-form-panel">
          <div className="panel-title">
            {editingId != null ? 'EDITING FORMULA' : 'ADD FORMULA'}
          </div>
          <div className="items-form">
            <div className="form-grid">
              <div className="form-field">
                <div className="field-label">Formula Name *</div>
                <input
                  className="text-input"
                  type="text"
                  placeholder="e.g. Tea"
                  maxLength={MAX_NAME_LENGTH}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>

              <div className="form-field">
                <div className="field-label">Add Ingredient</div>
                <div className="ing-row">
                  <select
                    className="select-input"
                    value={selItemId}
                    onChange={(event) => setSelItemId(event.target.value)}
                  >
                    <option value="">Select ingredient…</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} — {item.name}
                      </option>
                    ))}
                  </select>
                  <div className="input-row">
                    <input
                      className="weight-input ing-weight"
                      type="number"
                      step="0.001"
                      min="0"
                      placeholder="0.000"
                      inputMode="decimal"
                      value={ingWeight}
                      onChange={(event) => setIngWeight(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') addIngredient();
                      }}
                    />
                    <span className="unit">kg</span>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={addIngredient}>
                    ADD
                  </button>
                </div>
              </div>
            </div>

            {lines.length === 0 ? (
              <div className="panel-placeholder">No ingredients in this formula yet.</div>
            ) : (
              <div className="formula-builder-list">
                {lines.map((line, index) => (
                  <div key={`${line.itemId}-${index}`} className="formula-builder-row">
                    <span className="formula-builder-name">{line.itemName}</span>
                    <span className="num formula-builder-weight">{fmtWeight(line.requiredWeight)}</span>
                    <button
                      type="button"
                      className="remove-btn"
                      onClick={() => removeIngredient(index)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="formula-builder-total">
                  <span>Ingredients: {lines.length}</span>
                  <span className="num">Total: {fmtWeight(totalWeight)}</span>
                </div>
              </div>
            )}

            <div className="items-form-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={saveFormula}
              >
                {saving ? 'SAVING…' : editingId != null ? 'SAVE CHANGES' : 'CREATE FORMULA'}
              </button>
              {editingId != null && (
                <button type="button" className="btn btn-secondary" onClick={resetForm}>
                  CANCEL
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="panel items-list-panel">
          <div className="panel-title">FORMULA CATALOG ({formulas.length})</div>
          {formulas.length === 0 ? (
            <div className="panel-placeholder">
              No formulas yet. Create one with the form — e.g. Tea with Milk, Sugar, Tea powder.
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Formula</th>
                    <th>Ingredients</th>
                    <th className="text-right">Total Weight</th>
                    <th className="col-x" />
                  </tr>
                </thead>
                <tbody>
                  {formulas.map((formula) => (
                    <tr key={formula.id}>
                      <td>
                        <div className="formula-name">{formula.name}</div>
                        <div className="formula-lines">
                          {formula.lines.map((line) => (
                            <span key={line.id} className="formula-line-chip">
                              {line.itemName} {fmtWeight(line.requiredWeight)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td data-label="Ingredients" className="num">{formula.itemCount}</td>
                      <td data-label="Total Weight" className="num text-right">{fmtWeight(formula.totalWeight)}</td>
                      <td className="col-x">
                        <div className="formula-actions">
                          <button
                            type="button"
                            className="delete-btn"
                            onClick={() => startEdit(formula)}
                          >
                            EDIT
                          </button>
                          <button
                            type="button"
                            className={`delete-btn${confirmingId === formula.id ? ' confirming' : ''}`}
                            onClick={() => handleDelete(formula)}
                          >
                            {confirmingId === formula.id ? 'CONFIRM?' : 'DELETE'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}