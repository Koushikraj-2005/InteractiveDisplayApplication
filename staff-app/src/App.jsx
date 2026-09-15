import { useEffect, useState } from 'react';
import { VOICE_LANGS } from './lib/items.js';
import {
  evaluateReading,
  fmtWeight,
  localIsoNow,
  parseWeight,
  round3,
} from './lib/weights.js';
import { useWeightSource } from './lib/weightSource.js';
import { preloadAll, speakItem, stopSpeaking } from './lib/tts.js';
import { api } from './api.js';
import { WeighingTerminal } from './stages/WeighingTerminal.jsx';
import { ItemSelection } from './stages/ItemSelection.jsx';
import { CompletionScreen } from './stages/CompletionScreen.jsx';

const uid = () => Math.random().toString(36).slice(2, 9);

const NEUTRAL = { type: 'neutral', title: '', detail: '', difference: null, correct: false };

function StaffSelect({ formulas, items, itemsLoading, onFormula, onItem, onOpenBuilder }) {
  return (
    <section className="stage staff-select">
      <div className="staff-select-intro">
        <div className="screen-title">STAFF WEIGHING TERMINAL</div>
        <div className="screen-sub">
          Load a formula, build a weighing list with targets, or weigh a single item to a target.
        </div>
      </div>

      <div className="staff-select-grid">
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

        <div className="panel staff-panel staff-panel-build">
          <div className="panel-title">
            <span className="panel-num">2</span>
            <span>WEIGH ITEMS</span>
          </div>
          <div className="staff-panel-sub">
            Pick items from the master, set or change each target, then weigh the whole list.
          </div>
          <div className="staff-list-scroll">
            <button type="button" className="staff-row staff-cta-row" onClick={onOpenBuilder}>
              <span className="staff-cta-left">
                <span className="staff-cta-icon">+</span>
                <div className="staff-row-main">
                  <div className="staff-row-name">Build a weighing list</div>
                  <div className="staff-row-meta">Choose items · set targets · record a bill</div>
                </div>
              </span>
              <span className="staff-row-action">OPEN</span>
            </button>
          </div>
        </div>

        <div className="panel staff-panel staff-panel-single">
          <div className="panel-title">
            <span className="panel-num">3</span>
            <span>WEIGH A SINGLE ITEM</span>
            {items.length > 0 && <span className="panel-count">{items.length}</span>}
          </div>
          <div className="staff-panel-sub">
            Enter a target weight, then weigh the item on the terminal.
          </div>
          <div className="staff-list-scroll">
            {itemsLoading ? (
              <div className="panel-placeholder">Loading items…</div>
            ) : items.length === 0 ? (
              <div className="panel-placeholder">
                No items available. Add them in the admin portal first.
              </div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="staff-row"
                  onClick={() => onItem(item)}
                >
                  <div className="staff-row-main">
                    <div className="staff-row-code">{item.code}</div>
                    <div className="staff-row-name">{item.name}</div>
                  </div>
                  <span className="staff-row-action">WEIGH</span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function StaffTargetPrompt({ item, reqInput, reqError, onReqInput, onStart, onCancel, voiceLang, onSay }) {
  return (
    <section className="stage">
      <div className="staff-target-wrap">
        <div className="panel staff-target-card">
          <div className="panel-title">SET TARGET WEIGHT</div>
          <div className="staff-target-head">
            <div className="staff-free-code">{item.code}</div>
            <div className="current-item-name">{item.name.toUpperCase()}</div>
            <div className="current-item-local">{item.names[voiceLang] || item.name}</div>
            <button type="button" className="speaker-btn" onClick={onSay} aria-label="Say item name">
              🔊
            </button>
          </div>

          <div className="form-field">
            <div className="field-label">Required Weight (target)</div>
            <div className="input-row">
              <input
                id="single-target"
                className="weight-input"
                type="number"
                step="0.001"
                min="0"
                placeholder="0.000"
                inputMode="decimal"
                value={reqInput}
                onChange={(event) => onReqInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onStart();
                }}
              />
              <span className="unit">kg</span>
            </div>
            {reqError && <div className="error-text">{reqError}</div>}
          </div>

          <div className="staff-target-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              CANCEL
            </button>
            <button type="button" className="btn btn-primary btn-lg" onClick={onStart}>
              START WEIGHING
            </button>
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
  const [flow, setFlow] = useState('formula');
  const [cart, setCart] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [freeItem, setFreeItem] = useState(null);

  const [selectedItemId, setSelectedItemId] = useState(null);
  const [selectedFormulaId, setSelectedFormulaId] = useState(null);
  const [reqInput, setReqInput] = useState('');
  const [reqError, setReqError] = useState('');
  const [targetError, setTargetError] = useState('');

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

  useEffect(() => {
    if (selectedItemId != null && !items.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(null);
      setReqInput('');
    }
  }, [items, selectedItemId]);

  const selectedItem = items.find((item) => item.id === selectedItemId) || null;

  const activeItem = stage === 'weighing' ? cart[activeIndex] : null;
  const status = activeItem ? evaluateReading(activeItem.required, getReading()) : NEUTRAL;

  function openBuilder() {
    stopSpeaking();
    setCart([]);
    setSelectedItemId(null);
    setSelectedFormulaId(null);
    setReqInput('');
    setReqError('');
    setTargetError('');
    setSaveError('');
    setStage('build');
  }

  function goToMenu() {
    stopSpeaking();
    setCart([]);
    setActiveIndex(0);
    setFreeItem(null);
    setSelectedItemId(null);
    setSelectedFormulaId(null);
    setReqInput('');
    setReqError('');
    setTargetError('');
    setSavedBill(null);
    setSaveError('');
    setRaw('');
    setStage('select');
  }

  function cancelWeighing() {
    stopSpeaking();
    setActiveIndex(0);
    setRaw('');
    setSavedBill(null);
    setSaveError('');
    setStage('select');
  }

  function selectItem(id) {
    setSelectedItemId(id);
    setSelectedFormulaId(null);
    setReqInput('');
    setReqError('');
  }

  function selectFormula(id) {
    setSelectedFormulaId(id);
    setSelectedItemId(null);
    setReqInput('');
    setReqError('');
  }

  function loadFormulaIntoList(formula) {
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
    setCart(lines);
    setSelectedFormulaId(null);
  }

  function addToCart() {
    const required = parseWeight(reqInput);
    if (required == null || required <= 0) {
      setReqError('Enter a valid weight above zero, e.g. 2.000');
      return;
    }
    if (!selectedItem) return;
    setCart((prev) => [
      ...prev,
      {
        uid: uid(),
        id: selectedItem.id,
        slug: selectedItem.slug,
        name: selectedItem.name,
        names: selectedItem.names,
        required: round3(required),
        status: 'pending',
      },
    ]);
    setReqInput('');
    setReqError('');
  }

  function removeFromCart(itemUid) {
    setCart((prev) => prev.filter((item) => item.uid !== itemUid));
  }

  function updateTarget(itemUid, value) {
    const parsed = parseWeight(value);
    if (parsed == null || parsed <= 0) {
      setTargetError('Enter a valid target weight above zero, e.g. 2.000');
      return;
    }
    setTargetError('');
    setCart((prev) =>
      prev.map((item) =>
        item.uid === itemUid ? { ...item, required: round3(parsed) } : item,
      ),
    );
  }

  function beginWeighing() {
    if (cart.length === 0) return;
    stopSpeaking();
    setFlow('items');
    setActiveIndex(0);
    setRaw('');
    setTargetError('');
    setSaveError('');
    setStage('weighing');
  }

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
    setFlow('formula');
    setCart(lines);
    setActiveIndex(0);
    setRaw('');
    setSaveError('');
    setStage('weighing');
  }

  function startItem(item) {
    stopSpeaking();
    setFlow('single');
    setFreeItem(item);
    setReqInput('');
    setReqError('');
    setSaveError('');
    setStage('single-target');
  }

  function startSingleWeighing() {
    const required = parseWeight(reqInput);
    if (required == null || required <= 0) {
      setReqError('Enter a valid target above zero, e.g. 2.000');
      return;
    }
    if (!freeItem) return;
    stopSpeaking();
    setFlow('single');
    setCart([
      {
        uid: uid(),
        id: freeItem.id,
        slug: freeItem.slug,
        name: freeItem.name,
        names: freeItem.names,
        required: round3(required),
        status: 'pending',
      },
    ]);
    setActiveIndex(0);
    setRaw('');
    setSaveError('');
    setStage('weighing');
  }

  function saveBill(payload) {
    setSaving(true);
    setSaveError('');
    api
      .saveWeighing(payload)
      .then((bill) => {
        setSavedBill(bill);
        setSaving(false);
        setStage(flow === 'formula' ? 'done' : 'complete');
      })
      .catch((err) => {
        setSaveError(err.message);
        setSaving(false);
        setStage(flow === 'formula' ? 'done' : 'complete');
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
    setFreeItem(null);
    setSelectedItemId(null);
    setSelectedFormulaId(null);
    setReqInput('');
    setReqError('');
    setTargetError('');
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
            items={items}
            itemsLoading={itemsLoading}
            onFormula={startFormula}
            onItem={startItem}
            onOpenBuilder={openBuilder}
          />
        )}

        {stage === 'build' && (
          <ItemSelection
            items={items}
            itemsLoading={itemsLoading}
            formulas={formulas}
            cart={cart}
            selectedItemId={selectedItemId}
            selectedFormulaId={selectedFormulaId}
            reqInput={reqInput}
            reqError={reqError}
            targetError={targetError}
            onSelectItem={selectItem}
            onSelectFormula={selectFormula}
            onReqInput={setReqInput}
            onAddToCart={addToCart}
            onRemove={removeFromCart}
            onUpdateTarget={updateTarget}
            onStart={beginWeighing}
            onLoadFormula={loadFormulaIntoList}
            onCancel={goToMenu}
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

        {stage === 'single-target' && (
          <StaffTargetPrompt
            item={freeItem}
            reqInput={reqInput}
            reqError={reqError}
            voiceLang={voiceLang}
            onReqInput={setReqInput}
            onStart={startSingleWeighing}
            onCancel={startNew}
            onSay={() => speakItem(freeItem, voiceLang)}
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

        {stage === 'complete' && (
          <CompletionScreen
            cart={cart}
            savedBill={savedBill}
            saving={saving}
            saveError={saveError}
            onStartNew={startNew}
            onPrint={() => window.print()}
            onRetry={retrySave}
          />
        )}
      </main>
    </div>
  );
}