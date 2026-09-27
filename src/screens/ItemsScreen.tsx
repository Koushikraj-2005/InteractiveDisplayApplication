import { useState, type FormEvent } from 'react';
import { ApiError } from '../../shared/http.ts';
import type { Item } from '../lib/types.ts';
import { api } from '../api.ts';

const NATIVE_FIELDS: Array<{ key: 'name_hi' | 'name_bn' | 'name_ta'; label: string; placeholder: string }> = [
  { key: 'name_hi', label: 'Hindi Name', placeholder: 'Optional' },
  { key: 'name_bn', label: 'Bengali Name', placeholder: 'Optional' },
  { key: 'name_ta', label: 'Tamil Name', placeholder: 'Optional' },
];

const MAX_NAME_LENGTH = 60;

export interface ItemsScreenProps {
  items: Item[];
  itemsLoading: boolean;
  itemsError: string;
  onItemsChanged: () => void | Promise<void>;
}

export function ItemsScreen({
  items,
  itemsLoading,
  itemsError,
  onItemsChanged,
}: ItemsScreenProps) {
  const [name, setName] = useState('');
  const [native, setNative] = useState({ name_hi: '', name_bn: '', name_ta: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Item name is required');
      return;
    }
    if (trimmedName.length > MAX_NAME_LENGTH) {
      setFormError(`Item name must be ${MAX_NAME_LENGTH} characters or fewer`);
      return;
    }
    for (const field of NATIVE_FIELDS) {
      if (native[field.key].length > MAX_NAME_LENGTH) {
        setFormError(`${field.label} must be ${MAX_NAME_LENGTH} characters or fewer`);
        return;
      }
    }
    setSubmitting(true);
    setFormError('');
    try {
      await api.createItem({ name: trimmedName, ...native });
      setName('');
      setNative({ name_hi: '', name_bn: '', name_ta: '' });
      onItemsChanged();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item: Item) {
    if (confirmingId !== item.id) {
      setConfirmingId(item.id);
      window.setTimeout(() => {
        setConfirmingId((current) => (current === item.id ? null : current));
      }, 3000);
      return;
    }
    setConfirmingId(null);
    setFormError('');
    try {
      await api.deleteItem(item.id);
      onItemsChanged();
    } catch (err) {
      // A 409 means the item is still part of a formula. Deleting it anyway
      // used to leave the formula pointing at a row that no longer existed, so
      // the server refuses and the message names the formulas to fix first.
      if (err instanceof ApiError && err.status === 409) {
        setFormError(err.message);
        return;
      }
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  const hasItems = items.length > 0;

  return (
    <section className="stage">
      <div className="screen-title">ITEM MASTER</div>
      <div className="screen-sub">Add new products or remove discontinued ones from the master list.</div>

      {itemsError && (
        <div className="error-banner">
          Could not load items: {itemsError}{' '}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onItemsChanged}>
            RETRY
          </button>
        </div>
      )}

      <div className="items-layout">
        <div className="panel items-form-panel">
          <div className="panel-title">ADD ITEM</div>
          <div className="panel-sub">
            Native names + voice clips for all 4 languages are generated automatically.
          </div>
          <form className="items-form" onSubmit={handleAdd}>
            <div className="form-grid">
              <div className="form-field">
                <div className="field-label">English Name *</div>
                <input
                  className="text-input"
                  type="text"
                  placeholder="e.g. Oats"
                  maxLength={MAX_NAME_LENGTH}
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
                    maxLength={MAX_NAME_LENGTH}
                    value={native[field.key]}
                    onChange={(event) =>
                      setNative((prev) => ({ ...prev, [field.key]: event.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
            {formError && <div className="error-text">{formError}</div>}
            <div className="items-form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || !name.trim()}
              >
                {submitting ? 'SAVING…' : 'ADD ITEM'}
              </button>
            </div>
          </form>
        </div>

        <div className="panel items-list-panel">
          <div className="panel-title">MASTER LIST ({items.length})</div>
          {itemsLoading ? (
            <div className="panel-placeholder">Loading items…</div>
          ) : !hasItems ? (
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
                  {items.map((item: Item) => (
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