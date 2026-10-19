import { useState, useEffect, useRef } from 'react';
import type { FoodItem, LoggedFood } from '../mathEngine';
import { calcKcal } from '../mathEngine';
import {
  parseMealWithAI,
  parseMealOffline,
  convertParsedToLoggedFoods,
  type ParsedItem,
} from '../aiMealParser';
import {
  Sparkles,
  Mic,
  MicOff,
  Loader2,
  Check,
  Trash2,
  Plus,
  Key,
  ExternalLink,
  Bot,
  X,
} from 'lucide-react';

interface AIMealModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMeal: 'breakfast' | 'lunch' | 'dinner' | 'snacks';
  foodLibrary: FoodItem[];
  geminiKey: string;
  onSaveGeminiKey: (key: string) => void;
  onConfirmLog: (loggedFoods: LoggedFood[], newFoods: FoodItem[]) => void;
}

const EXAMPLE_PROMPTS = [
  '2 scrambled eggs with 1 slice sourdough toast and half an avocado',
  'Chipotle bowl with white rice, black beans, double chicken, and cheese',
  '200g Greek yogurt with a scoop of whey protein and 50g blueberries',
  'Braised beef with a bowl of steamed jasmine rice and broccoli',
];

export function AIMealModal({
  isOpen,
  onClose,
  defaultMeal,
  foodLibrary,
  geminiKey,
  onSaveGeminiKey,
  onConfirmLog,
}: AIMealModalProps) {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Parsed state
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [targetMeal, setTargetMeal] = useState<'breakfast' | 'lunch' | 'dinner' | 'snacks'>(
    defaultMeal
  );

  // Key configuration
  const [showKeyInput, setShowKeyInput] = useState(!geminiKey);
  const [tempKey, setTempKey] = useState(geminiKey);

  // Speech Recognition
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    setTargetMeal(defaultMeal);
  }, [defaultMeal]);

  useEffect(() => {
    setTempKey(geminiKey);
    if (geminiKey) setShowKeyInput(false);
  }, [geminiKey]);

  // Speech Recognition setup
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        const transcript = event.results[0]?.[0]?.transcript || '';
        setInputText((prev) => (prev ? `${prev} ${transcript}` : transcript));
        setIsListening(false);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleVoiceRecording = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in this browser. Try Chrome or Safari.');
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setIsListening(true);
      setErrorMsg(null);
      recognitionRef.current.start();
    }
  };

  const handleParse = async () => {
    const query = inputText.trim();
    if (!query) {
      setErrorMsg('Please describe what you ate first.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      // 1. Try AI parse (queries serverless /api/parse-meal with global key, or client key)
      try {
        const result = await parseMealWithAI(query, geminiKey, defaultMeal);
        setParsedItems(result.items);
        setTargetMeal(result.meal);
        return;
      } catch (aiErr: any) {
        if (aiErr.message !== 'NO_KEY_CONFIGURED') {
          console.warn('AI error, falling back to USDA heuristic', aiErr);
        }
      }

      // 2. Fallback to USDA / offline parser
      const result = await parseMealOffline(query, defaultMeal, foodLibrary);
      setParsedItems(result.items);
      setTargetMeal(result.meal);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to parse meal. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const updateItemGrams = (id: string, grams: number) => {
    setParsedItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, grams: Math.max(1, grams) } : item))
    );
  };

  const removeItem = (id: string) => {
    setParsedItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleAddNewItem = () => {
    setParsedItems((prev) => [
      ...prev,
      {
        id: `manual_${Date.now()}`,
        name: 'Additional Food',
        category: 'Custom',
        grams: 100,
        p: 10,
        c: 10,
        f: 5,
        explanation: 'Custom item',
      },
    ]);
  };

  // Compute live meal totals
  const mealTotals = parsedItems.reduce(
    (acc, it) => {
      const ratio = it.grams / 100;
      const p = it.p * ratio;
      const c = it.c * ratio;
      const f = it.f * ratio;
      acc.p += p;
      acc.c += c;
      acc.f += f;
      acc.kcal += calcKcal(p, c, f);
      return acc;
    },
    { p: 0, c: 0, f: 0, kcal: 0 }
  );

  const handleConfirm = () => {
    if (parsedItems.length === 0) return;
    const { loggedFoods, foodItems } = convertParsedToLoggedFoods(parsedItems, targetMeal);
    onConfirmLog(loggedFoods, foodItems);
    // Reset and close
    setInputText('');
    setParsedItems([]);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                AI Natural Language Meal Logger
                <span className="text-[10px] font-mono bg-indigo-950/80 text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded">
                  {geminiKey ? 'Gemini 1.5 Flash' : 'Smart USDA Engine'}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Type or speak what you ate — AI estimates portions in grams and macros.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* API Key Banner / Toggle if user wants full AI */}
          {(!geminiKey || showKeyInput) && (
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-amber-400" />
                  Enable Full AI Recipe Reasoning (Google Gemini)
                </span>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-mono text-[11px]"
                >
                  Get Free Key <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Paste your free Gemini key to parse complex restaurant meals, slang, and home recipes.
                Without a key, MacroPulse will use the built-in USDA heuristic parser.
              </p>
              <div className="flex gap-2 pt-1">
                <input
                  type="password"
                  placeholder="Paste Gemini API key (AIzaSy...)"
                  value={tempKey}
                  onChange={(e) => setTempKey(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    onSaveGeminiKey(tempKey);
                    setShowKeyInput(false);
                  }}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-mono transition"
                >
                  Save Key
                </button>
              </div>
            </div>
          )}

          {/* Text Area & Voice Input */}
          <div className="space-y-2">
            <div className="relative">
              <textarea
                rows={3}
                placeholder="Tell MacroPulse what you ate... e.g. 'I had 2 scrambled eggs with 1 slice of sourdough toast and half an avocado for breakfast'"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleParse();
                  }
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 pr-12 resize-none"
              />

              {/* Mic Dictation Button */}
              <button
                type="button"
                onClick={toggleVoiceRecording}
                className={`absolute right-3 top-3 p-2 rounded-lg border transition ${
                  isListening
                    ? 'bg-rose-600 text-white border-rose-500 animate-pulse'
                    : 'bg-slate-900 text-slate-400 hover:text-white border-slate-800'
                }`}
                title={isListening ? 'Stop listening' : 'Dictate with voice'}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            </div>

            {/* Quick Prompt Suggestions */}
            {parsedItems.length === 0 && (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[11px] text-slate-500 font-mono py-1">Try:</span>
                {EXAMPLE_PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setInputText(p)}
                    className="text-[11px] font-mono bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded-md transition text-left"
                  >
                    &quot;{p.slice(0, 36)}...&quot;
                  </button>
                ))}
              </div>
            )}

            {errorMsg && (
              <div className="text-xs font-mono text-rose-400 bg-rose-950/40 border border-rose-800/60 p-2.5 rounded-lg">
                {errorMsg}
              </div>
            )}
          </div>

          {/* Action to Parse */}
          {parsedItems.length === 0 && (
            <button
              type="button"
              onClick={handleParse}
              disabled={isLoading || !inputText.trim()}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-mono font-semibold transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-950"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing Meal & Calculating Grams...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  Parse & Estimate Macros
                </>
              )}
            </button>
          )}

          {/* PARSED REVIEW SECTION */}
          {parsedItems.length > 0 && (
            <div className="space-y-4 pt-2">
              {/* Telemetry Bar & Meal Destination */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-wrap justify-between items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-mono">Assign to:</span>
                  <select
                    value={targetMeal}
                    onChange={(e) =>
                      setTargetMeal(
                        e.target.value as 'breakfast' | 'lunch' | 'dinner' | 'snacks'
                      )
                    }
                    className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs font-mono text-emerald-400 font-semibold"
                  >
                    <option value="breakfast">Breakfast</option>
                    <option value="lunch">Lunch</option>
                    <option value="dinner">Dinner</option>
                    <option value="snacks">Snacks</option>
                  </select>
                </div>

                {/* Total Macros */}
                <div className="flex items-center gap-3 font-mono text-xs">
                  <div className="text-white font-bold">
                    {Math.round(mealTotals.kcal)} <span className="text-slate-500 text-[10px]">kcal</span>
                  </div>
                  <div className="text-emerald-400 font-bold">
                    {mealTotals.p.toFixed(1)}g <span className="text-slate-500 text-[10px]">P</span>
                  </div>
                  <div className="text-amber-400 font-bold">
                    {mealTotals.c.toFixed(1)}g <span className="text-slate-500 text-[10px]">C</span>
                  </div>
                  <div className="text-rose-400 font-bold">
                    {mealTotals.f.toFixed(1)}g <span className="text-slate-500 text-[10px]">F</span>
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                {parsedItems.map((item) => {
                  const ratio = item.grams / 100;
                  const itemKcal = Math.round(calcKcal(item.p, item.c, item.f) * ratio);
                  const itemP = (item.p * ratio).toFixed(1);
                  const itemC = (item.c * ratio).toFixed(1);
                  const itemF = (item.f * ratio).toFixed(1);

                  return (
                    <div
                      key={item.id}
                      className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-200">
                            {item.name}
                          </span>
                          {item.explanation && (
                            <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded">
                              {item.explanation}
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-mono text-slate-400 mt-1">
                          {itemKcal} kcal ·{' '}
                          <span className="text-emerald-400">{itemP}g P</span> ·{' '}
                          <span className="text-amber-400">{itemC}g C</span> ·{' '}
                          <span className="text-rose-400">{itemF}g F</span>
                        </div>
                      </div>

                      {/* Portion slider and remove */}
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={5}
                          max={600}
                          step={5}
                          value={item.grams}
                          onChange={(e) => updateItemGrams(item.id, Number(e.target.value))}
                          className="w-24 accent-indigo-500"
                        />
                        <input
                          type="number"
                          value={item.grams}
                          onChange={(e) => updateItemGrams(item.id, Number(e.target.value))}
                          className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-right text-white"
                        />
                        <span className="text-xs font-mono text-slate-500">g</span>
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="text-slate-500 hover:text-rose-400 p-1 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bottom Buttons: Add Item & Reset */}
              <div className="flex justify-between items-center text-xs font-mono text-slate-400 pt-1">
                <button
                  type="button"
                  onClick={handleAddNewItem}
                  className="hover:text-indigo-400 flex items-center gap-1 transition"
                >
                  <Plus className="w-3.5 h-3.5" /> Add another item
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setParsedItems([]);
                    setInputText('');
                  }}
                  className="hover:text-slate-200 transition"
                >
                  Start over
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {parsedItems.length > 0 && (
          <div className="p-4 border-t border-slate-800 bg-slate-950 flex justify-between items-center gap-3">
            <button
              type="button"
              onClick={() => setParsedItems([])}
              className="px-3.5 py-2 text-xs font-mono text-slate-400 hover:text-white transition"
            >
              Back to Input
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-mono font-semibold transition flex items-center gap-2 shadow-lg shadow-emerald-950"
            >
              <Check className="w-4 h-4" />
              Log All ({parsedItems.length} items) to {targetMeal.toUpperCase()}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
