import { useState } from 'react';
import { api } from '../api.js';

const NATIVE_FIELDS = [
  { key: 'name_hi', label: 'Hindi Name', placeholder: 'Optional' },
  { key: 'name_bn', label: 'Bengali Name', placeholder: 'Optional' },
  { key: 'name_ta', label: 'Tamil Name', placeholder: 'Optional' },
];

export function ItemsScreen({ items, itemsError, onItemsChanged }) {
  const [name, setName] = useState('');
  const [native, setNative] = useState({ name_hi: '', name_bn: '', name_ta: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);

  async function handleAdd(event) {
    event.preventDefault();
    if (!name.trim()) {
      setFormError('Item name is required');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await api.createItem({ name: name.trim(), ...native });
      setName('');
      setNative({ name_hi: '', name_bn: '', name_ta: '' });
      onItemsChanged();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item) {
    if (confirmingId !== item.id) {
      setConfirmingId(item.id);
      window.setTimeout(() => {
        setConfirmingId((current) => (current === item.id ? null : current));
      }, 3000);
      return;
    }
    setConfirmingId(null);
    try {
      await api.deleteItem(item.id);
      onItemsChanged();
    } catch (err) {
      setFormError(err.message);
    }
  }

  const hasItems = items.length > 0;

  return (
    <section className="stage">
      <div className="screen-title">ITEM MASTER</div>
      <div className="screen-sub">Add new products or remove discontinued ones from the master list.</div>

      {itemsError && <div className="error-banner">Could not load items: {itemsError}</div>}

      <div className="items-layout">
        <div className="panel items-form-panel">
          <div className="panel-title">ADD ITEM</div>
          <div className="panel-sub">
            Native names + voice clips for all 4 languages are generated automatically.
          </div>
          <form className="items-form" onSubmit={handleAdd}>
            <div className="form-field">
              <div className="field-label">English Name *</div>
              <input
                className="text-input"
                type="text"
                placeholder="e.g. Oats"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            {NATIVE_FIELDS.map((field) => (
              <div className="form-field" key={field.key}>
                <div className="field-label">{field.label}</div>
                <input
                  className="text-input"
                  type="text"
                  placeholder={field.placeholder}
                  value={native[field.key]}
                  onChange={(event) =>
                    setNative((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                />
              </div>
            ))}
            {formError && <div className="error-text">{formError}</div>}
            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={submitting || !name.trim()}
            >
              {submitting ? 'SAVING…' : 'ADD ITEM'}
            </button>
          </form>
        </div>

        <div className="panel items-list-panel">
          <div className="panel-title">MASTER LIST ({items.length})</div>
          {!hasItems ? (
            <div className="panel-placeholder">No items yet. Add one using the form.</div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Hindi</th>
                    <th>Bengali</th>
                    <th>Tamil</th>
                    <th>Added</th>
                    <th className="col-x" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Code" className="num">{item.code}</td>
                      <td data-label="Name" className="item-name">{item.name}</td>
                      <td data-label="Hindi">{item.names.hi || '—'}</td>
                      <td data-label="Bengali">{item.names.bn || '—'}</td>
                      <td data-label="Tamil">{item.names.ta || '—'}</td>
                      <td data-label="Added" className="num muted">{(item.createdAt || '').slice(0, 10)}</td>
                      <td className="col-x">
                        <button
                          type="button"
                          className={`delete-btn${confirmingId === item.id ? ' confirming' : ''}`}
                          onClick={() => handleDelete(item)}
                        >
                          {confirmingId === item.id ? 'CONFIRM?' : 'DELETE'}
                        </button>
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