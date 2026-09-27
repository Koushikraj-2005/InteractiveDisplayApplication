import { useEffect, useMemo, useRef, useState } from 'react';
import { VOICE_LANGS } from './lib/items.ts';
import {
  evaluateReading,
  fmtWeight,
  localIsoNow,
  round3,
  type ReadingVerdict,
} from './lib/weights.ts';
import { ReZeroLatch } from '../../shared/reZeroLatch.ts';
import { useAutoAdvance } from '../../shared/useAutoAdvance.ts';
import { useWeightSource } from './lib/weightSource.ts';
import { preloadAll, stopSpeaking } from './lib/tts.ts';
import { api, type WeighingPayload } from './api.ts';
import { WeighingTerminal } from './stages/WeighingTerminal.tsx';
import { ScaleConnection } from './components/ScaleConnection.tsx';
import type { Bill, CartItem, Formula, Item, LangCode } from './lib/types.ts';
import { FontSizeControl } from '../../shared/FontSizeControl.tsx';
import { roundOffWeight, roundTargetWeight } from '../../shared/targetWeight.ts';

type Stage = 'select' | 'weighing' | 'done';

const uid = () => Math.random().toString(36).slice(2, 9);

const NEUTRAL: ReadingVerdict = {
  type: 'neutral',
  title: '',
  detail: '',
  difference: null,
  correct: false,
};

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The staff terminal has no menu to return to, so a phone that locks, reloads
 * or gets its tab killed mid-weighing used to lose the whole cart with no way
 * to recover it. The cart is kept in sessionStorage (per-tab, cleared when the
 * tab closes) so a refresh resumes the same formula at the same line.
 */
const CART_KEY = 'koushi.staff.cart';

interface PersistedCart {
  formulaId: number | null;
  formulaName: string | null;
  lines: Array<{
    uid: string;
    id: number | null;
    slug: string;
    name: string;
    required: number;
    status: CartItem['status'];
    actual?: number | null;
    formulaName?: string | null;
    formulaId?: number | null;
  }>;
}

function saveCart(cart: CartItem[], formulaId: number | null): void {
  try {
    const first = cart.find((line: CartItem) => line.formulaId != null);
    const payload: PersistedCart = {
      formulaId: first?.formulaId ?? formulaId,
      formulaName: first?.formulaName ?? null,
      lines: cart.map((line: CartItem) => ({
        uid: line.uid,
        id: line.id,
        slug: line.slug,
        name: line.name,
        required: roundTargetWeight(line.required),
        status: line.status,
        actual: line.actual ?? null,
        formulaName: line.formulaName ?? null,
        formulaId: line.formulaId ?? null,
      })),
    };
    window.sessionStorage.setItem(CART_KEY, JSON.stringify(payload));
  } catch {
    // storage unavailable: the weighing still works, it just will not survive
    // a refresh
  }
}

function loadCart(): PersistedCart | null {
  try {
    const raw = window.sessionStorage.getItem(CART_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedCart;
    if (!parsed || !Array.isArray(parsed.lines) || parsed.lines.length === 0) return null;
    // Anything in an unexpected shape is discarded rather than half-restored.
    if (parsed.lines.some((line) => !line.name || !Number.isFinite(line.required))) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearStoredCart(): void {
  try {
    window.sessionStorage.removeItem(CART_KEY);
  } catch {
    // nothing to clear
  }
}

interface StaffSelectProps {
  formulas: Formula[];
  itemsLoading: boolean;
  onFormula: (formula: Formula) => void;
}

function StaffSelect({ formulas, itemsLoading, onFormula }: StaffSelectProps) {
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
              formulas.map((formula: Formula) => (
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

interface StaffDoneProps {
  bill: Bill | null;
  saving: boolean;
  saveError: string;
  onRetry: () => void;
  onAgain: () => void;
}

function StaffDone({ bill, saving, saveError, onRetry, onAgain }: StaffDoneProps) {
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
  const [items, setItems] = useState<Item[]>([]);
  const [formulas, setFormulas] = useState<Formula[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // No language picker any more: every announcement leads in English and the
  // underweight repeat walks the remaining languages on its own.
  const voiceLang: LangCode = 'en';

  const [stage, setStage] = useState<Stage>('select');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // True when a weighing was restored from storage, so the operator is told
  // rather than silently dropped back into a half-finished bill.
  const [resumed, setResumed] = useState(false);

  const [savedBill, setSavedBill] = useState<Bill | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [lastPayload, setLastPayload] = useState<WeighingPayload | null>(null);

  const { mode, setMode, raw, setRaw, getReading, live, device, ports, baudRates,
    portsLoading, refreshPorts, deviceBusy, deviceError, connect, disconnect } =
    useWeightSource();
  const latch = useMemo(() => new ReZeroLatch(), []);
  // Guards against a second POST for the same weighing. The button is disabled
  // while saving, but a fast double tap, an Enter keypress, or a retried click
  // can all fire before React re-renders, which previously created two bills.
  const savingRef = useRef(false);
  const advancedUidRef = useRef<string | null>(null);

  async function loadData() {
    setItemsLoading(true);
    setLoadError('');
    // Loaded independently: one failing catalog must not hide the other, since
    // a staff member can still weigh a formula whose items are not loaded yet.
    const [itemResult, formulaResult] = await Promise.allSettled([
      api.getItems(),
      api.getFormulas(),
    ]);
    const problems: string[] = [];
    if (itemResult.status === 'fulfilled') {
      setItems(Array.isArray(itemResult.value) ? itemResult.value : []);
    } else {
      problems.push(`items: ${errText(itemResult.reason)}`);
    }
    if (formulaResult.status === 'fulfilled') {
      setFormulas(Array.isArray(formulaResult.value) ? formulaResult.value : []);
    } else {
      problems.push(`formulas: ${errText(formulaResult.reason)}`);
    }
    setLoadError(problems.join(' · '));
    setItemsLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (items.length > 0) preloadAll(items, VOICE_LANGS);
  }, [items]);

  // Resume a weighing that was interrupted by a refresh or a locked screen.
  // Only lines that were never completed are restored, and the operator is
  // told it happened rather than silently re-entering a bill.
  useEffect(() => {
    const stored = loadCart();
    if (!stored) return;
    // If the item master has since changed, rebuild names from it where we can.
    const restored: CartItem[] = stored.lines.map((line) => {
      const item = items.find((candidate: Item) => candidate.id === line.id);
      return {
        uid: line.uid,
        id: line.id,
        slug: item ? item.slug : line.slug,
        name: item ? item.name : line.name,
        names: item ? item.names : { en: line.name, hi: '', bn: '', ta: '' },
        required: roundTargetWeight(line.required),
        status: 'pending',
        formulaName: line.formulaName ?? stored.formulaName,
        formulaId: line.formulaId ?? stored.formulaId,
      };
    });
    setCart(restored);
    setActiveIndex(0);
    setResumed(true);
    latch.reset();
    setStage('weighing');
    // Reached once on mount: the item master is still loading, and a second
    // pass would fight the operator who may already have moved on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeItem = stage === 'weighing' ? cart[activeIndex] : null;
  const status: ReadingVerdict = activeItem
    ? evaluateReading(activeItem.required, getReading())
    : NEUTRAL;
  const liveSettled = mode !== 'weighing' || (Boolean(device.connected) && live?.stable === true);
  const readingStale = latch.isStale(getReading());
  const nextEnabled = status.correct && liveSettled && !readingStale;
  // A correct weight advances on its own, so the operator never has to reach
  // for the button mid-pour.
  const autoAdvanceMs = useAutoAdvance({
    ready: nextEnabled,
    token: activeItem ? `${activeIndex}:${activeItem.uid}:${activeItem.required}` : null,
    onAdvance: handleNext,
  });

  function startFormula(formula: Formula) {
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
    stopSpeaking();
    setCart(lines);
    setActiveIndex(0);
    setRaw('');
    setSaveError('');
    setLastPayload(null);
    latch.reset();
    setResumed(false);
    clearStoredCart();
    saveCart(lines, formula.id);
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
    latch.reset();
    setResumed(false);
    clearStoredCart();
    setStage('select');
  }

  function saveBill(payload: WeighingPayload) {
    // Synchronous guard: a second call in the same tick must be dropped before
    // it can reach the network, otherwise one weighing produces two bills.
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    // Leave the weighing stage before awaiting, so the terminal and its NEXT
    // button unmount immediately and cannot be pressed again while saving.
    setStage('done');
    api
      .saveWeighing(payload)
      .then((bill: Bill) => {
        setSavedBill(bill);
      })
      .catch((err) => {
        setSaveError(errText(err));
      })
      .finally(() => {
        savingRef.current = false;
        setSaving(false);
      });
  }

  function retrySave() {
    if (!lastPayload) return;
    saveBill(lastPayload);
  }

  function handleNext() {
    if (!activeItem) return;
    // A tap on NEXT can land in the same moment the auto-advance timer fires.
    // Both would advance the same line, so the second one is dropped.
    if (advancedUidRef.current === activeItem.uid) return;
    advancedUidRef.current = activeItem.uid;
    const current = getReading();
    if (current == null || round3(current - activeItem.required) !== 0) return;
    if (latch.isStale(current) || (mode === 'weighing' && live?.stable !== true)) return;
    const actual = round3(current);
    const completed: CartItem[] = cart.map((item: CartItem, index: number) =>
      index === activeIndex ? { ...item, status: 'completed', actual } : item,
    );
    setCart(completed);
    saveCart(completed, null);
    latch.latch(actual);
    if (activeIndex < cart.length - 1) {
      setActiveIndex(activeIndex + 1);
      setRaw('');
      return;
    }
    const lines = completed.map((item: CartItem) => ({
      itemId: item.id,
      itemName: item.name,
      requiredWeight: item.required,
      actualWeight: item.actual == null ? null : roundOffWeight(item.actual),
    }));
    const payload: WeighingPayload = {
      weighedAt: localIsoNow(),
      lines,
      formulaName: activeItem.formulaName || null,
    };
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
    latch.reset();
    setResumed(false);
    clearStoredCart();
    setStage('select');
  }

  return (
    <div className="app staff-app">
      <header className="app-header staff-header">
        <div className="brand">
          <span className="brand-glyph">⚖</span>
          <span className="brand-text">
            <span className="brand-owner">REMAN INFRASTRUCTURE (P) LIMITED</span>
            <span className="brand-name">NAVEEN POULTRY FARMS</span>
          </span>
          <span className="staff-header-tag">STAFF TERMINAL</span>
        </div>
        <div className="header-controls">
          <FontSizeControl />
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

        {resumed && stage === 'weighing' && (
          <div className="error-banner resume-banner">
            This weighing was restored after the page reloaded. Check the queue, then
            continue from line 1.{' '}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                stopSpeaking();
                setCart([]);
                setActiveIndex(0);
                setRaw('');
                setResumed(false);
                clearStoredCart();
                latch.reset();
                setStage('select');
              }}
            >
              DISCARD
            </button>
          </div>
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

      <footer className="app-footer no-print">© Copyright Reem Engineering Enterprises</footer>
    </div>
  );
}