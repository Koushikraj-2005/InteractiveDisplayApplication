import { useEffect, useMemo, useRef, useState } from 'react';
import { VOICE_LANGS } from './lib/items.ts';
import {
  evaluateReading,
  localIsoNow,
  parseWeight,
  round3,
  type ReadingVerdict,
} from './lib/weights.ts';
import { ReZeroLatch } from '../shared/reZeroLatch.ts';
import { useAutoAdvance } from '../shared/useAutoAdvance.ts';
import { useWeightSource } from './lib/weightSource.ts';
import { preloadAll, stopSpeaking } from './lib/tts.ts';
import { api, type WeighingPayload } from './api.ts';
import { ItemSelection } from './stages/ItemSelection.tsx';
import { WeighingTerminal } from './stages/WeighingTerminal.tsx';
import { CompletionScreen } from './stages/CompletionScreen.tsx';
import { ScaleConnection } from './components/ScaleConnection.tsx';
import { ItemsScreen } from './screens/ItemsScreen.tsx';
import { HistoryScreen } from './screens/HistoryScreen.tsx';
import { ReportsScreen } from './screens/ReportsScreen.tsx';
import { FormulasScreen } from './screens/FormulasScreen.tsx';
import { ServerScreen } from './screens/ServerScreen.tsx';
import {
  getServerOrigin,
  isNativeApp,
  needsServerAddress,
  subscribeToServerAddress,
} from './lib/serverAddress.ts';
import type { Bill, CartItem, Formula, Item, LangCode } from './lib/types.ts';
import { FontSizeControl } from '../shared/FontSizeControl.tsx';
import { roundOffWeight, roundTargetWeight, targetRoundingNote } from '../shared/targetWeight.ts';

type ScreenKey = 'weighing' | 'formulas' | 'history' | 'reports' | 'items';
type Stage = 'select' | 'weighing' | 'complete';

const SCREENS: Array<{ key: ScreenKey; label: string }> = [
  { key: 'weighing', label: 'WEIGHING' },
  { key: 'formulas', label: 'FORMULAS' },
  { key: 'history', label: 'HISTORY' },
  { key: 'reports', label: 'REPORTS' },
  { key: 'items', label: 'ITEM MASTER' },
];

const uid = () => Math.random().toString(36).slice(2, 9);

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const NEUTRAL: ReadingVerdict = {
  type: 'neutral',
  title: '',
  detail: '',
  difference: null,
  correct: false,
};

export default function App() {
  const [screen, setScreen] = useState<ScreenKey>('weighing');
  const [stage, setStage] = useState<Stage>('select');
  const [items, setItems] = useState<Item[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState('');
  const [formulas, setFormulas] = useState<Formula[]>([]);
  const [formulasError, setFormulasError] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [selectedFormulaId, setSelectedFormulaId] = useState<number | null>(null);
  const [reqInput, setReqInput] = useState('');
  const [reqError, setReqError] = useState('');
  // No language picker any more: every announcement leads in English and the
  // underweight repeat walks the remaining languages on its own.
  const voiceLang: LangCode = 'en';
  const [savedBill, setSavedBill] = useState<Bill | null>(null);
  const [billSaving, setBillSaving] = useState(false);
  const [billError, setBillError] = useState('');
  const [billPayload, setBillPayload] = useState<WeighingPayload | null>(null);
  // The Android build cannot do anything until a server address is stored.
  const [showServer, setShowServer] = useState(needsServerAddress);
  const [serverOrigin, setServerOriginState] = useState(getServerOrigin);
  useEffect(() => subscribeToServerAddress(() => {
    setServerOriginState(getServerOrigin());
    setShowServer(needsServerAddress());
  }), []);
  const { mode, setMode, raw, setRaw, getReading, live, device, ports, baudRates, portsLoading, refreshPorts, deviceBusy, deviceError, connect, disconnect } =
    useWeightSource();
  const latch = useMemo(() => new ReZeroLatch(), []);
  const lastReadingRef = useRef<number | null>(null);
  const advancedUidRef = useRef<string | null>(null);

  async function loadItems(silent = false) {
    if (!silent) setItemsLoading(true);
    setItemsError('');
    try {
      const list = await api.getItems();
      setItems(Array.isArray(list) ? list : []);
    } catch (err) {
      setItemsError(errText(err));
    } finally {
      setItemsLoading(false);
    }
  }

  async function loadFormulas() {
    setFormulasError('');
    try {
      const list = await api.getFormulas();
      setFormulas(Array.isArray(list) ? list : []);
    } catch (err) {
      setFormulasError(errText(err));
    }
  }

  useEffect(() => {
    loadItems();
    loadFormulas();
  }, []);

  useEffect(() => {
    if (items.length > 0) preloadAll(items, VOICE_LANGS);
  }, [items]);

  useEffect(() => {
    if (selectedItemId != null && !items.some((item: Item) => item.id === selectedItemId)) {
      setSelectedItemId(null);
      setReqInput('');
    }
  }, [items, selectedItemId]);

  const selectedItem = items.find((item: Item) => item.id === selectedItemId) ?? null;

  const activeItem = stage !== 'select' ? cart[activeIndex] : null;
  const status: ReadingVerdict = activeItem
    ? evaluateReading(activeItem.required, getReading())
    : NEUTRAL;
  // A live scale must be settled before a line counts, otherwise a reading
  // that merely swept past the target mid-placement gets accepted.
  const liveSettled = mode !== 'weighing' || (Boolean(device.connected) && live?.stable === true);
  const readingStale = latch.isStale(getReading());
  const nextEnabled = status.correct && liveSettled && !readingStale;
  // A correct weight advances on its own, so the operator never has to reach
  // for the button mid-pour.
  // Tell the operator the moment a typed target will be snapped, rather than
  // letting the rounded figure appear only on the bill.
  const reqRoundingNote = targetRoundingNote(parseWeight(reqInput) ?? NaN);

  const autoAdvanceMs = useAutoAdvance({
    ready: nextEnabled,
    token: activeItem ? `${activeIndex}:${activeItem.uid}:${activeItem.required}` : null,
    onAdvance: handleNext,
  });

  // Remember the last seen reading so a weighing session can be resumed or
  // audited from the live value after re-renders.
  useEffect(() => {
    lastReadingRef.current = getReading();
  });

  function selectItem(id: number) {
    setSelectedItemId(id);
    setSelectedFormulaId(null);
    setReqInput('');
    setReqError('');
  }

  function selectFormula(id: number) {
    setSelectedFormulaId(id);
    setSelectedItemId(null);
    setReqInput('');
    setReqError('');
  }

  function loadFormula(formula: Formula) {
    const lines: CartItem[] = formula.lines
      .map((line): CartItem => {
        const item = items.find((candidate: Item) => candidate.id === line.itemId);
        return {
          uid: uid(),
          id: line.itemId ?? null,
          slug: item ? item.slug : '',
          name: item ? item.name : line.itemName,
          names: item ? item.names : { en: line.itemName, hi: '', bn: '', ta: '' },
          required: roundTargetWeight(line.requiredWeight),
          status: 'pending',
          formulaId: formula.id,
          formulaName: formula.name,
        };
      });
    if (lines.length === 0) return;
    setCart(lines);
    setSelectedFormulaId(null);
    stopSpeaking();
  }

  function addToCart() {
    const required = parseWeight(reqInput);
    if (required == null || required <= 0) {
      setReqError('Enter a valid weight above zero, e.g. 2.000');
      return;
    }
    // Checked after rounding so a 0.0004 kg target cannot be rounded away into
    // a 0.000 kg line that the server then rejects as an empty weighing.
    if (round3(required) <= 0) {
      setReqError('That weight rounds to zero at 0.001 kg precision. Enter 0.001 or more.');
      return;
    }
    // Snapped to a weight the scale can actually show, so the line is
    // reachable and still moves on by itself when the target lands.
    const target = roundTargetWeight(required);
    if (!selectedItem) return;
    setCart((prev) => [
      ...prev,
      {
        uid: uid(),
        id: selectedItem.id,
        slug: selectedItem.slug,
        name: selectedItem.name,
        names: selectedItem.names,
        required: target,
        status: 'pending',
      },
    ]);
    setReqInput('');
    setReqError('');
  }

  function removeFromCart(id: string) {
    setCart((prev) => prev.filter((item) => item.uid !== id));
  }

  function beginWeighing() {
    if (cart.length === 0) return;
    setActiveIndex(0);
    setRaw('');
    latch.reset();
    lastReadingRef.current = null;
    setStage('weighing');
  }

  function handleNext() {
    if (!activeItem) return;
    // A tap on NEXT can land in the same moment the auto-advance timer fires.
    // Both would advance the same line, so the second one is dropped.
    if (advancedUidRef.current === activeItem.uid) return;
    advancedUidRef.current = activeItem.uid;
    const current = getReading();
    if (current == null || round3(current - activeItem.required) !== 0) return;
    // Re-check the latch here as well as in the button, so a stale reading
    // cannot slip through via the Enter key or a stale render.
    if (latch.isStale(current) || (mode === 'weighing' && live?.stable !== true)) return;
    // Record what the scale actually read, so a bill shows target vs measured.
    const actual = round3(current);
    // Built from the current cart rather than via the updater, because the last
    // line is saved in the same tick and the updater's result is not readable
    // until the next render.
    const completed: CartItem[] = cart.map((item: CartItem, index: number) =>
      index === activeIndex ? { ...item, status: 'completed', actual } : item,
    );
    setCart(completed);
    // The previous item is still on the scale. Latch its weight so the next
    // line needs a genuinely different reading.
    latch.latch(actual);
    if (activeIndex < cart.length - 1) {
      setActiveIndex(activeIndex + 1);
      setRaw('');
    } else {
      completeWeighing(completed);
    }
  }

  function completeWeighing(completed: CartItem[]) {
    const lines = completed.map((item: CartItem) => ({
      itemId: item.id,
      itemName: item.name,
      requiredWeight: item.required,
      // Recorded rounded to whole kilograms, the same figure the operator was
      // shown and the verdict accepted, so the bill agrees with the screen.
      actualWeight: item.actual == null ? null : roundOffWeight(item.actual),
    }));
    const formulaNames = new Set(
      completed
        .map((item: CartItem) => item.formulaName)
        .filter((name): name is string => Boolean(name)),
    );
    const formulaName = formulaNames.size === 1 ? [...formulaNames][0] : null;
    const payload: WeighingPayload = { weighedAt: localIsoNow(), lines, formulaName };
    setBillPayload(payload);
    setStage('complete');
    setSavedBill(null);
    setBillError('');
    setBillSaving(true);
    api
      .saveWeighing(payload)
      .then((bill: Bill) => {
        setSavedBill(bill);
        setBillSaving(false);
      })
      .catch((err) => {
        setBillError(errText(err));
        setBillSaving(false);
      });
  }

  function retrySave() {
    if (!billPayload) return;
    setSavedBill(null);
    setBillError('');
    setBillSaving(true);
    api
      .saveWeighing(billPayload)
      .then((bill: Bill) => {
        setSavedBill(bill);
        setBillSaving(false);
      })
      .catch((err) => {
        setBillError(errText(err));
        setBillSaving(false);
      });
  }

  function cancelWeighing() {
    stopSpeaking();
    setActiveIndex(0);
    setRaw('');
    latch.reset();
    lastReadingRef.current = null;
    setSavedBill(null);
    setBillError('');
    setBillPayload(null);
    setStage('select');
  }

  function startNewWeighing() {
    stopSpeaking();
    setCart([]);
    setActiveIndex(0);
    setRaw('');
    latch.reset();
    lastReadingRef.current = null;
    setSelectedItemId(null);
    setReqInput('');
    setReqError('');
    setSavedBill(null);
    setBillError('');
    setBillPayload(null);
    setStage('select');
  }

  function printReport() {
    window.print();
  }

  // No address yet means the Android app is useless, so setup replaces the
  // whole terminal. Once one is stored this is only ever reached to change it,
  // and then it must offer a way back out — the SERVER tab is how the address
  // gets edited, so it opens the edit screen with a CANCEL, not the hard
  // first-run screen.
  if (showServer) {
    const editing = !needsServerAddress();
    return (
      <div className="app">
        <header className="app-header">
          <div className="brand">
            <span className="brand-glyph">⚖</span>
            <span className="brand-text">
              <span className="brand-owner">REMAN INFRASTRUCTURE (P) LIMITED</span>
              <span className="brand-name">NAVEEN POULTRY FARMS</span>
            </span>
          </div>
        </header>
        <main>
          <ServerScreen
            firstRun={!editing}
            onDone={() => setShowServer(false)}
            onCancel={editing ? () => setShowServer(false) : undefined}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-glyph">⚖</span>
          <span className="brand-text">
            <span className="brand-owner">REMAN INFRASTRUCTURE (P) LIMITED</span>
            <span className="brand-name">NAVEEN POULTRY FARMS</span>
          </span>
        </div>
        <div className="header-controls">
          <FontSizeControl />
          {isNativeApp() && serverOrigin && (
            <button
              type="button"
              className="btn btn-secondary btn-sm server-chip"
              onClick={() => setShowServer(true)}
              title="Change the weighing server this app uses"
            >
              {serverOrigin.replace(/^https?:\/\//, '')}
            </button>
          )}
          <ScaleConnection
            mode={mode}
            setMode={setMode}
            device={device}
            ports={ports}
            baudRates={baudRates}
            portsLoading={portsLoading}
            refreshPorts={refreshPorts}
            deviceBusy={deviceBusy}
            deviceError={deviceError}
            connect={connect}
            disconnect={disconnect}
            locked={stage === 'weighing'}
          />
        </div>
      </header>

      <nav className="nav-tabs">
        {SCREENS.map((entry: { key: ScreenKey; label: string }) => (
          <button
            key={entry.key}
            type="button"
            className={`nav-tab${screen === entry.key ? ' active' : ''}`}
            onClick={() => setScreen(entry.key)}
          >
            {entry.label}
          </button>
        ))}
        {isNativeApp() && serverOrigin && (
          <button
            type="button"
            className="nav-tab server-tab"
            onClick={() => setShowServer(true)}
          >
            SERVER
          </button>
        )}
      </nav>

      <main>
        {isNativeApp() && showServer && !needsServerAddress() && (
          <div className="panel server-edit-bar">
            <ServerScreen
              firstRun={false}
              onDone={() => setShowServer(false)}
              onCancel={() => setShowServer(false)}
            />
          </div>
        )}
        {itemsError && screen === 'weighing' && (
          <div className="error-banner">
            Item master unavailable: {itemsError}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadItems()}>
              RETRY
            </button>
          </div>
        )}

        {formulasError && screen === 'weighing' && (
          <div className="error-banner">
            Formula catalog unavailable: {formulasError}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadFormulas()}>
              RETRY
            </button>
          </div>
        )}

        {screen === 'weighing' && (
          <>
            {stage === 'select' && (
              <ItemSelection
                items={items}
                itemsLoading={itemsLoading}
                formulas={formulas}
                cart={cart}
                selectedItemId={selectedItemId}
                selectedFormulaId={selectedFormulaId}
                reqInput={reqInput}
                roundingNote={reqRoundingNote}
                reqError={reqError}
                onSelectItem={selectItem}
                onSelectFormula={selectFormula}
                onReqInput={setReqInput}
                onAddToCart={addToCart}
                onRemove={removeFromCart}
                onStart={beginWeighing}
                onLoadFormula={loadFormula}
              />
            )}

            {stage === 'weighing' && (
              <WeighingTerminal
                cart={cart}
                activeIndex={activeIndex}
                activeItem={activeItem}
                status={status}
                autoAdvanceMs={autoAdvanceMs}
                reading={mode === 'weighing' ? (live?.weight != null ? String(live.weight) : '') : raw}
                nextEnabled={nextEnabled}
                nextBlockedReason={
                  readingStale
                    ? latch.staleReason()
                    : mode === 'weighing' && status.correct && !liveSettled
                      ? 'Waiting for the scale reading to settle…'
                      : null
                }
                voiceLang={voiceLang}
                mode={mode}
                device={device}
                live={live}
                onReading={setRaw}
                onNext={handleNext}
                onCancel={cancelWeighing}
              />
            )}

            {stage === 'complete' && (
              <CompletionScreen
                cart={cart}
                savedBill={savedBill}
                saving={billSaving}
                saveError={billError}
                onStartNew={startNewWeighing}
                onPrint={printReport}
                onViewHistory={() => setScreen('history')}
                onRetry={retrySave}
              />
            )}
          </>
        )}

        {screen === 'items' && (
          <ItemsScreen
            items={items}
            itemsLoading={itemsLoading}
            itemsError={itemsError}
            onItemsChanged={() => {
              loadItems();
              loadFormulas();
            }}
          />
        )}

        {screen === 'formulas' && (
          <FormulasScreen
            items={items}
            formulas={formulas}
            formulasError={formulasError}
            onFormulasChanged={loadFormulas}
          />
        )}

        {screen === 'history' && <HistoryScreen />}

        {screen === 'reports' && <ReportsScreen />}
      </main>

      <footer className="app-footer no-print">© Copyright Reem Engineering Enterprises</footer>
    </div>
  );
}