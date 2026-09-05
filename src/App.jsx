import { useState } from 'react';
import { AVAILABLE_ITEMS } from './lib/items.js';
import { evaluateReading, parseWeight, round3 } from './lib/weights.js';
import { useWeightSource } from './lib/weightSource.js';
import { stopSpeaking } from './lib/tts.js';
import { ItemSelection } from './stages/ItemSelection.jsx';
import { WeighingTerminal } from './stages/WeighingTerminal.jsx';
import { CompletionScreen } from './stages/CompletionScreen.jsx';

const uid = () => Math.random().toString(36).slice(2, 9);

export default function App() {
  const [stage, setStage] = useState('select');
  const [cart, setCart] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [reqInput, setReqInput] = useState('');
  const [reqError, setReqError] = useState('');
  const { raw, setRaw, getReading } = useWeightSource();

  const activeItem = stage !== 'select' ? cart[activeIndex] : null;
  const status = activeItem
    ? evaluateReading(activeItem.required, getReading())
    : { type: 'neutral', title: '', detail: '', difference: null, correct: false };

  function selectItem(id) {
    setSelectedItemId(id);
    setReqInput('');
    setReqError('');
  }

  function addToCart() {
    const required = parseWeight(reqInput);
    if (required == null || required <= 0) {
      setReqError('Enter a valid weight above zero, e.g. 2.000');
      return;
    }
    const item = AVAILABLE_ITEMS.find((candidate) => candidate.id === selectedItemId);
    setCart((prev) => [
      ...prev,
      { uid: uid(), name: item.name, required: round3(required), status: 'pending' },
    ]);
    setReqInput('');
    setReqError('');
  }

  function removeFromCart(id) {
    setCart((prev) => prev.filter((item) => item.uid !== id));
  }

  function beginWeighing() {
    if (cart.length === 0) return;
    setActiveIndex(0);
    setRaw('');
    setStage('weighing');
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
    } else {
      setStage('complete');
    }
  }

  function startNewWeighing() {
    stopSpeaking();
    setCart([]);
    setActiveIndex(0);
    setRaw('');
    setSelectedItemId(null);
    setReqInput('');
    setReqError('');
    setStage('select');
  }

  function printReport() {
    window.print();
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-glyph">⚖</span>
          <span className="brand-name">WEIGHING SYSTEM</span>
        </div>
        <span className="mode-badge">
          SIMULATION MODE
          <span className="mode-dot" />
        </span>
      </header>

      <main>
        {stage === 'select' && (
          <ItemSelection
            items={AVAILABLE_ITEMS}
            cart={cart}
            selectedItemId={selectedItemId}
            reqInput={reqInput}
            reqError={reqError}
            onSelectItem={selectItem}
            onReqInput={setReqInput}
            onAddToCart={addToCart}
            onRemove={removeFromCart}
            onStart={beginWeighing}
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
            onReading={setRaw}
            onNext={handleNext}
          />
        )}

        {stage === 'complete' && (
          <CompletionScreen
            cart={cart}
            onStartNew={startNewWeighing}
            onPrint={printReport}
          />
        )}
      </main>
    </div>
  );
}