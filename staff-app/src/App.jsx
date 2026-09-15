import { useEffect, useState } from 'react';
import { VOICE_LANGS } from './lib/items.js';
import {
  evaluateReading,
  fmtWeight,
  localIsoNow,
  round3,
} from './lib/weights.js';
import { useWeightSource } from './lib/weightSource.js';
import { preloadAll, stopSpeaking } from './lib/tts.js';
import { api } from './api.js';
import { WeighingTerminal } from './stages/WeighingTerminal.jsx';

const uid = () => Math.random().toString(36).slice(2, 9);

const NEUTRAL = { type: 'neutral', title: '', detail: '', difference: null, correct: false };

function StaffSelect({ formulas, itemsLoading, onFormula }) {
  return (
    <section className="stage staff-select">
      <div className="staff-select-intro">
        <div className="screen-title">STAFF WEIGHING TERMINAL</div>
        <div className="screen-sub">
          Load a formula and weigh each item to its exact target.
        </div>
      </div>

      <div className="staff-select-grid single">
        <div className="panel staff-panel staff-panel-formula">
          <div className="panel-title">
            <span className="panel-num">1</span>
            <span>LOAD A FORMULA</span>
            {formulas.length > 0 && <span className="panel-count">{formulas.length}</span>}
          </div>
          <div className="staff-panel-sub">
            Weigh a pre-set combination exactly. The next item unlocks only once the target is met.
          </div>
          <div className="staff-list-scroll">
            {itemsLoading ? (
              <div className="panel-placeholder">Loading formulas…</div>
            ) : formulas.length === 0 ? (
              <div className="panel-placeholder">
                No formulas available. Create one in the admin portal first.
              </div>
            ) : (
              formulas.map((formula) => (
                <button
                  key={formula.id}
                  type="button"
                  className="staff-row"
                  onClick={() => onFormula(formula)}
                >
                  <div className="staff-row-main">
                    <div className="staff-row-name">{formula.name}</div>
                    <div className="staff-row-meta">
                      {formula.itemCount} item{formula.itemCount === 1 ? '' : 's'} ·{' '}
                      {fmtWeight(formula.totalWeight)}
                    </div>
                  </div>
                  <span className="staff-row-action">START</span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function StaffDone({ bill, saving, saveError, onRetry, onAgain }) {
  return (
    <section className="stage staff-done">
      <div className="panel staff-done-card">
        <div className="staff-done-icon">{bill ? '✓' : saving ? '…' : '!'}</div>
        <div className="screen-title">{saving ? 'SAVING WEIGHING…' : bill ? 'WEIGHING RECORDED' : 'SAVE FAILED'}</div>
        {bill && (
          <div className="staff-done-facts">
            <div className="staff-done-fact">
              <span className="staff-done-label">Bill No.</span>
              <span className="staff-done-value">{bill.batchNo}</span>
            </div>
            <div className="staff-done-fact">
              <span className="staff-done-label">Items Weighed</span>
              <span className="staff-done-value">{bill.itemCount}</span>
            </div>
            <div className="staff-done-fact">
              <span className="staff-done-label">Total Weight</span>
              <span className="staff-done-value">{fmtWeight(bill.totalWeight)}</span>
            </div>
          </div>
        )}
        {saveError && (
          <div className="error-text">
            {saveError}{' '}
            {onRetry && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
                RETRY SAVE
              </button>
            )}
          </div>
        )}
        {!saving && (
          <button type="button" className="btn btn-primary btn-lg" onClick={onAgain}>
            WEIGH ANOTHER
          </button>
        )}
      </div>
    </section>
  );
}

export default function StaffApp() {
  const [items, setItems] = useState([]);
  const [formulas, setFormulas] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [voiceLang, setVoiceLang] = useState('en');

  const [stage, setStage] = useState('select');
  const [cart, setCart] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const [savedBill, setSavedBill] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [lastPayload, setLastPayload] = useState(null);

  const { raw, setRaw, getReading } = useWeightSource();

  async function loadData() {
    setItemsLoading(true);
    setLoadError('');
    try {
      const [itemList, formulaList] = await Promise.all([api.getItems(), api.getFormulas()]);
      setItems(Array.isArray(itemList) ? itemList : []);
      setFormulas(Array.isArray(formulaList) ? formulaList : []);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setItemsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (items.length > 0) preloadAll(items, VOICE_LANGS);
  }, [items]);

  const activeItem = stage === 'weighing' ? cart[activeIndex] : null;
  const status = activeItem ? evaluateReading(activeItem.required, getReading()) : NEUTRAL;

  function startFormula(formula) {
    const lines = formula.lines
      .map((line) => {
        const item = items.find((candidate) => candidate.id === line.itemId);
        return {
          uid: uid(),
          id: line.itemId,
          slug: item ? item.slug : null,
          name: item ? item.name : line.itemName,
          names: item ? item.names : { en: line.itemName, hi: '', bn: '', ta: '' },
          required: round3(line.requiredWeight),
          status: 'pending',
          formulaId: formula.id,
          formulaName: formula.name,
        };
      })
      .filter(Boolean);
    if (lines.length === 0) return;
    stopSpeaking();
    setCart(lines);
    setActiveIndex(0);
    setRaw('');
    setSaveError('');
    setLastPayload(null);
    setStage('weighing');
  }

  function cancelWeighing() {
    stopSpeaking();
    setCart([]);
    setActiveIndex(0);
    setRaw('');
    setSavedBill(null);
    setSaveError('');
    setLastPayload(null);
    setStage('select');
  }

  function saveBill(payload) {
    setSaving(true);
    setSaveError('');
    api
      .saveWeighing(payload)
      .then((bill) => {
        setSavedBill(bill);
        setSaving(false);
        setStage('done');
      })
      .catch((err) => {
        setSaveError(err.message);
        setSaving(false);
        setStage('done');
      });
  }

  function retrySave() {
    if (!lastPayload) return;
    saveBill(lastPayload);
  }

  function handleNext() {
    const current = getReading();
    if (current == null || round3(current - activeItem.required) !== 0) return;
    setCart((prev) =>
      prev.map((item, index) =>
        index === activeIndex ? { ...item, status: 'completed' } : item,
      ),
    );
    if (activeIndex < cart.length - 1) {
      setActiveIndex(activeIndex + 1);
      setRaw('');
      return;
    }
    const lines = cart.map((item) => ({
      itemId: item.id,
      itemName: item.name,
      requiredWeight: item.required,
    }));
    const payload = { weighedAt: localIsoNow(), lines, formulaName: activeItem.formulaName || null };
    setLastPayload(payload);
    saveBill(payload);
  }

  function startNew() {
    stopSpeaking();
    setCart([]);
    setActiveIndex(0);
    setSavedBill(null);
    setSaveError('');
    setLastPayload(null);
    setRaw('');
    setStage('select');
  }

  return (
    <div className="app staff-app">
      <header className="app-header staff-header">
        <div className="brand">
          <span className="brand-glyph">⚖</span>
          <span className="brand-name">NAVEEN FARMS</span>
          <span className="staff-header-tag">STAFF TERMINAL</span>
        </div>
        <div className="header-controls">
          <label className="voice-label" htmlFor="staff-voice-lang">
            Speak
          </label>
          <select
            id="staff-voice-lang"
            className="lang-select"
            value={voiceLang}
            onChange={(event) => setVoiceLang(event.target.value)}
          >
            {VOICE_LANGS.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <main>
        {loadError && (
          <div className="error-banner">
            Could not load data: {loadError}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={loadData}>
              RETRY
            </button>
          </div>
        )}

        {stage === 'select' && (
          <StaffSelect
            formulas={formulas}
            itemsLoading={itemsLoading}
            onFormula={startFormula}
          />
        )}

        {stage === 'weighing' && (
          <WeighingTerminal
            cart={cart}
            activeIndex={activeIndex}
            activeItem={activeItem}
            status={status}
            reading={raw}
            nextEnabled={status.correct}
            voiceLang={voiceLang}
            onReading={setRaw}
            onNext={handleNext}
            onCancel={cancelWeighing}
          />
        )}

        {stage === 'done' && (
          <StaffDone
            bill={savedBill}
            saving={saving}
            saveError={saveError}
            onRetry={retrySave}
            onAgain={startNew}
          />
        )}
      </main>
    </div>
  );
}