import { useEffect, useState } from 'react';
import { VOICE_LANGS } from './lib/items.js';
import {
  evaluateReading,
  localIsoNow,
  parseWeight,
  round3,
} from './lib/weights.js';
import { useWeightSource } from './lib/weightSource.js';
import { preloadAll, stopSpeaking } from './lib/tts.js';
import { api } from './api.js';
import { ItemSelection } from './stages/ItemSelection.jsx';
import { WeighingTerminal } from './stages/WeighingTerminal.jsx';
import { CompletionScreen } from './stages/CompletionScreen.jsx';
import { ItemsScreen } from './screens/ItemsScreen.jsx';
import { HistoryScreen } from './screens/HistoryScreen.jsx';
import { ReportsScreen } from './screens/ReportsScreen.jsx';
import { RecipesScreen } from './screens/RecipesScreen.jsx';

const SCREENS = [
  { key: 'weighing', label: 'WEIGHING' },
  { key: 'recipes', label: 'RECIPES' },
  { key: 'history', label: 'HISTORY' },
  { key: 'reports', label: 'REPORTS' },
  { key: 'items', label: 'ITEM MASTER' },
];

const uid = () => Math.random().toString(36).slice(2, 9);

export default function App() {
  const [screen, setScreen] = useState('weighing');
  const [stage, setStage] = useState('select');
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState('');
  const [recipes, setRecipes] = useState([]);
  const [recipesError, setRecipesError] = useState('');
  const [cart, setCart] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [selectedRecipeId, setSelectedRecipeId] = useState(null);
  const [reqInput, setReqInput] = useState('');
  const [reqError, setReqError] = useState('');
  const [voiceLang, setVoiceLang] = useState('en');
  const [savedBill, setSavedBill] = useState(null);
  const [billSaving, setBillSaving] = useState(false);
  const [billError, setBillError] = useState('');
  const { raw, setRaw, getReading } = useWeightSource();

  async function loadItems(silent = false) {
    if (!silent) setItemsLoading(true);
    setItemsError('');
    try {
      setItems(await api.getItems());
    } catch (err) {
      setItemsError(err.message);
    } finally {
      setItemsLoading(false);
    }
  }

  async function loadRecipes() {
    setRecipesError('');
    try {
      setRecipes(await api.getRecipes());
    } catch (err) {
      setRecipesError(err.message);
    }
  }

  useEffect(() => {
    loadItems();
    loadRecipes();
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

  const activeItem = stage !== 'select' ? cart[activeIndex] : null;
  const status = activeItem
    ? evaluateReading(activeItem.required, getReading())
    : { type: 'neutral', title: '', detail: '', difference: null, correct: false };

  function selectItem(id) {
    setSelectedItemId(id);
    setSelectedRecipeId(null);
    setReqInput('');
    setReqError('');
  }

  function selectRecipe(id) {
    setSelectedRecipeId(id);
    setSelectedItemId(null);
    setReqInput('');
    setReqError('');
  }

  function loadRecipe(recipe) {
    const lines = recipe.lines
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
          recipeId: recipe.id,
          recipeName: recipe.name,
        };
      })
      .filter(Boolean);
    if (lines.length === 0) return;
    setCart(lines);
    setSelectedRecipeId(null);
    stopSpeaking();
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
      completeWeighing();
    }
  }

  function completeWeighing() {
    const lines = cart.map((item) => ({
      itemId: item.id,
      itemName: item.name,
      requiredWeight: item.required,
    }));
    const totalWeight = round3(cart.reduce((sum, item) => sum + item.required, 0));
    const recipeNames = new Set(
      cart.map((item) => item.recipeName).filter((name) => Boolean(name)),
    );
    const recipeName = recipeNames.size === 1 ? [...recipeNames][0] : null;
    setStage('complete');
    setSavedBill(null);
    setBillError('');
    setBillSaving(true);
    api
      .saveWeighing({ weighedAt: localIsoNow(), lines, totalWeight, recipeName })
      .then((bill) => {
        setSavedBill(bill);
        setBillSaving(false);
      })
      .catch((err) => {
        setBillError(err.message);
        setBillSaving(false);
      });
  }

  function startNewWeighing() {
    stopSpeaking();
    setCart([]);
    setActiveIndex(0);
    setRaw('');
    setSelectedItemId(null);
    setReqInput('');
    setReqError('');
    setSavedBill(null);
    setBillError('');
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
        <div className="header-controls">
          <label className="voice-label" htmlFor="voice-lang">
            Speak
          </label>
          <select
            id="voice-lang"
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
          <span className="mode-badge">
            SIMULATION MODE
            <span className="mode-dot" />
          </span>
        </div>
      </header>

      <nav className="nav-tabs">
        {SCREENS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`nav-tab${screen === entry.key ? ' active' : ''}`}
            onClick={() => setScreen(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <main>
        {itemsError && screen === 'weighing' && (
          <div className="error-banner">
            Item master unavailable: {itemsError}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadItems()}>
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
                recipes={recipes}
                cart={cart}
                selectedItemId={selectedItemId}
                selectedRecipeId={selectedRecipeId}
                reqInput={reqInput}
                reqError={reqError}
                onSelectItem={selectItem}
                onSelectRecipe={selectRecipe}
                onReqInput={setReqInput}
                onAddToCart={addToCart}
                onRemove={removeFromCart}
                onStart={beginWeighing}
                onLoadRecipe={loadRecipe}
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
              />
            )}
          </>
        )}

        {screen === 'items' && (
          <ItemsScreen
            items={items}
            itemsError={itemsError}
            onItemsChanged={() => {
              loadItems();
              loadRecipes();
            }}
          />
        )}

        {screen === 'recipes' && (
          <RecipesScreen
            items={items}
            recipes={recipes}
            onRecipesChanged={loadRecipes}
          />
        )}

        {screen === 'history' && <HistoryScreen />}

        {screen === 'reports' && <ReportsScreen />}
      </main>
    </div>
  );
}