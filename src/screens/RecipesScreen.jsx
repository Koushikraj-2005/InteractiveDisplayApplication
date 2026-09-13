import { useState } from 'react';
import { api } from '../api.js';
import { fmtWeight } from '../lib/weights.js';

export function RecipesScreen({ items, recipes, onRecipesChanged }) {
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
  }

  function startEdit(recipe) {
    setEditingId(recipe.id);
    setName(recipe.name);
    setLines(
      recipe.lines.map((line) => ({
        itemId: line.itemId,
        itemName: line.itemName,
        requiredWeight: line.requiredWeight,
      })),
    );
    setSelItemId('');
    setIngWeight('');
    setError('');
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

  async function saveRecipe() {
    if (!name.trim()) {
      setError('Recipe name is required');
      return;
    }
    if (lines.length === 0) {
      setError('Add at least one ingredient to the recipe');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      name: name.trim(),
      lines: lines.map((line) => ({ itemId: line.itemId, requiredWeight: line.requiredWeight })),
    };
    try {
      if (editingId != null) {
        await api.updateRecipe(editingId, payload);
      } else {
        await api.createRecipe(payload);
      }
      resetForm();
      onRecipesChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(recipe) {
    if (confirmingId !== recipe.id) {
      setConfirmingId(recipe.id);
      window.setTimeout(() => {
        setConfirmingId((current) => (current === recipe.id ? null : current));
      }, 3000);
      return;
    }
    setConfirmingId(null);
    try {
      await api.deleteRecipe(recipe.id);
      if (editingId === recipe.id) resetForm();
      onRecipesChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  const totalWeight = lines.reduce((sum, line) => sum + line.requiredWeight, 0);

  return (
    <section className="stage">
      <div className="screen-title">
        {editingId != null ? `EDIT RECIPE` : 'RECIPES'}
      </div>
      <div className="screen-sub">
        A recipe is a pre-set combination of ingredients with their exact weighing targets.
        Load a recipe at the weighing terminal to start weighing it immediately.
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="items-layout">
        <div className="panel items-form-panel">
          <div className="panel-title">
            {editingId != null ? 'EDITING RECIPE' : 'ADD RECIPE'}
          </div>
          <div className="items-form">
            <div className="form-field">
              <div className="field-label">Recipe Name *</div>
              <input
                className="text-input"
                type="text"
                placeholder="e.g. Tea"
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

            {lines.length === 0 ? (
              <div className="panel-placeholder">No ingredients in this recipe yet.</div>
            ) : (
              <div className="recipe-builder-list">
                {lines.map((line, index) => (
                  <div key={`${line.itemId}-${index}`} className="recipe-builder-row">
                    <span className="recipe-builder-name">{line.itemName}</span>
                    <span className="num recipe-builder-weight">{fmtWeight(line.requiredWeight)}</span>
                    <button
                      type="button"
                      className="remove-btn"
                      onClick={() => removeIngredient(index)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="recipe-builder-total">
                  <span>Ingredients: {lines.length}</span>
                  <span className="num">Total: {fmtWeight(totalWeight)}</span>
                </div>
              </div>
            )}

            <div className="recipe-form-actions">
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={saving}
                onClick={saveRecipe}
              >
                {saving ? 'SAVING…' : editingId != null ? 'SAVE CHANGES' : 'CREATE RECIPE'}
              </button>
              {editingId != null && (
                <button type="button" className="btn btn-secondary btn-block" onClick={resetForm}>
                  CANCEL
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="panel items-list-panel">
          <div className="panel-title">RECIPE CATALOG ({recipes.length})</div>
          {recipes.length === 0 ? (
            <div className="panel-placeholder">
              No recipes yet. Create one with the form — e.g. Tea with Milk, Sugar, Tea powder.
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Recipe</th>
                    <th>Ingredients</th>
                    <th className="text-right">Total Weight</th>
                    <th className="col-x" />
                  </tr>
                </thead>
                <tbody>
                  {recipes.map((recipe) => (
                    <tr key={recipe.id}>
                      <td>
                        <div className="recipe-name">{recipe.name}</div>
                        <div className="recipe-lines">
                          {recipe.lines.map((line) => (
                            <span key={line.id} className="recipe-line-chip">
                              {line.itemName} {fmtWeight(line.requiredWeight)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="num">{recipe.itemCount}</td>
                      <td className="num text-right">{fmtWeight(recipe.totalWeight)}</td>
                      <td className="col-x">
                        <div className="recipe-actions">
                          <button
                            type="button"
                            className="delete-btn"
                            onClick={() => startEdit(recipe)}
                          >
                            EDIT
                          </button>
                          <button
                            type="button"
                            className={`delete-btn${confirmingId === recipe.id ? ' confirming' : ''}`}
                            onClick={() => handleDelete(recipe)}
                          >
                            {confirmingId === recipe.id ? 'CONFIRM?' : 'DELETE'}
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