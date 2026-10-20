import { useState, useEffect, useMemo, useRef } from 'react';
import { DEFAULT_FOODS } from './foodDb';
import {
  calcKcal,
  calcMifflinStJeor,
  solveMacroDeficit3x3,
} from './mathEngine';
import type { FoodItem, LoggedFood } from './mathEngine';
import type { HistoryStore, UserProfile, DayRecord } from './types';
import {
  loadProfile,
  saveProfile,
  loadHistory,
  saveHistory,
  getTodayDate,
  shiftDate,
  formatDisplayDate,
  calculateDayTotals,
  exportBackupJSON,
  parseBackupJSON,
  generateDemoHistory,
} from './storage';
import { TrendCharts } from './components/TrendCharts';
import { AIMealModal } from './components/AIMealModal';
import { AuthModal } from './components/AuthModal';
import { BarcodeScannerModal } from './components/BarcodeScannerModal';
import { useAuthSession } from './auth';
import {
  fetchCloudProfile,
  saveCloudProfile,
  fetchCloudDailyLogs,
  saveCloudDailyLog,
  fetchCloudCustomFoods,
  saveCloudCustomFood,
} from './cloudSync';
import { smartDiscoverMacros, type NutritionSearchResult } from './nutritionApi';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Download,
  Upload,
  Sparkles,
  RotateCcw,
  Scale,
  CheckCircle,
  Database,
  Search,
  Loader2,
  Key,
  Check,
  Utensils,
  Cloud,
  ScanBarcode,
} from 'lucide-react';

const CATEGORIES = [
  'All',
  'Protein',
  'Seafood',
  'Dairy & Eggs',
  'Carbs',
  'Home-Cooked',
  'Produce',
  'Fats',
  'Packaged',
  'Custom',
] as const;

type FoodCategory = typeof CATEGORIES[number];

export default function App() {
  // Navigation View
  const [activeTab, setActiveTab] = useState<'logger' | 'trends' | 'data'>('logger');

  // AWS Authentication & Cloud Session
  const { email: userEmail, isAuthenticated, logout } = useAuthSession();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // User Profile
  const [profile, setProfile] = useState<UserProfile>(() => loadProfile());

  // Date Navigation
  const [activeDate, setActiveDate] = useState<string>(() => getTodayDate());

  // Food Library with custom + default merger
  const [foods, setFoods] = useState<FoodItem[]>(() => {
    const saved = localStorage.getItem('mp_foods');
    if (!saved) return DEFAULT_FOODS;
    try {
      const parsed: FoodItem[] = JSON.parse(saved);
      const defaultIds = new Set(DEFAULT_FOODS.map((f) => f.id));
      const customOnly = parsed.filter(
        (f) => !defaultIds.has(f.id) || f.category === 'Custom' || f.id.startsWith('custom_')
      );
      return [...customOnly, ...DEFAULT_FOODS];
    } catch {
      return DEFAULT_FOODS;
    }
  });

  // History Store (keyed by YYYY-MM-DD)
  const [history, setHistory] = useState<HistoryStore>(() =>
    loadHistory(profile.weightKg)
  );

  // Active Day Record
  const activeRecord: DayRecord = useMemo(() => {
    return (
      history[activeDate] || {
        date: activeDate,
        weightKg: profile.weightKg,
        items: [],
      }
    );
  }, [history, activeDate, profile.weightKg]);

  const activeItems = activeRecord.items;

  // Active Meal bucket & Search & Category filter
  const [selectedMeal, setSelectedMeal] = useState<
    'breakfast' | 'lunch' | 'dinner' | 'snacks'
  >('lunch');
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<FoodCategory>('All');

  // Custom Food Creator State
  const [newFoodName, setNewFoodName] = useState('');
  const [newFoodP, setNewFoodP] = useState('');
  const [newFoodC, setNewFoodC] = useState('');
  const [newFoodF, setNewFoodF] = useState('');
  const [newFoodGrams, setNewFoodGrams] = useState('100');

  // Auto-lookup state
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupCandidates, setLookupCandidates] = useState<NutritionSearchResult[]>([]);
  const [geminiKey, setGeminiKey] = useState<string>(
    () =>
      localStorage.getItem('mp_gemini_key') ||
      (import.meta as any).env?.VITE_GEMINI_API_KEY ||
      ''
  );
  const [keyInput, setKeyInput] = useState<string>(geminiKey);
  const [isAIMealModalOpen, setIsAIMealModalOpen] = useState(false);
  const [isBarcodeModalOpen, setIsBarcodeModalOpen] = useState(false);

  // File import ref
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notification, setNotification] = useState<string | null>(null);

  // Cloud Sync state & IDs
  const [cloudProfileId, setCloudProfileId] = useState<string | null>(null);
  const cloudLogIds = useRef<Record<string, string>>({});
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3800);
  };

  // Two-way AWS Cloud Sync when user is authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    let isMounted = true;

    async function initialSync() {
      setIsCloudSyncing(true);
      try {
        // 1. Fetch remote user profile
        const cloudP = await fetchCloudProfile();
        if (cloudP && isMounted) {
          setCloudProfileId(cloudP.id);
          setProfile(cloudP.profile);
        } else if (!cloudP) {
          const newId = await saveCloudProfile(profile);
          if (newId && isMounted) setCloudProfileId(newId);
        }

        // 2. Fetch remote daily logs
        const cloudLogs = await fetchCloudDailyLogs();
        if (cloudLogs && Object.keys(cloudLogs).length > 0 && isMounted) {
          const merged: HistoryStore = { ...history };
          for (const [d, entry] of Object.entries(cloudLogs)) {
            cloudLogIds.current[d] = entry.id;
            merged[d] = entry.record;
          }
          setHistory(merged);
          saveHistory(merged);
        }

        // 3. Fetch remote custom foods
        const cloudFoods = await fetchCloudCustomFoods();
        if (cloudFoods && cloudFoods.length > 0 && isMounted) {
          setFoods((prev) => {
            const existingNames = new Set(prev.map((f) => f.name.toLowerCase()));
            const toAdd = cloudFoods.filter((f) => !existingNames.has(f.name.toLowerCase()));
            return [...toAdd, ...prev];
          });
        }
        showNotification('AWS Cloud Sync Active');
      } catch (err) {
        console.warn('Initial cloud sync error', err);
      } finally {
        if (isMounted) setIsCloudSyncing(false);
      }
    }

    initialSync();
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  // Sync profile to localStorage & AWS DynamoDB
  useEffect(() => {
    saveProfile(profile);
    if (isAuthenticated) {
      saveCloudProfile(profile, cloudProfileId || undefined).then((id) => {
        if (id && !cloudProfileId) setCloudProfileId(id);
      });
    }
  }, [profile, isAuthenticated, cloudProfileId]);

  // Sync foods to localStorage
  useEffect(() => {
    localStorage.setItem('mp_foods', JSON.stringify(foods));
  }, [foods]);

  // Sync gemini key
  const handleSaveGeminiKey = (k: string) => {
    setGeminiKey(k.trim());
    localStorage.setItem('mp_gemini_key', k.trim());
    showNotification('AI API Key saved');
  };

  // Metabolic Targets
  const { bmr, tdee } = useMemo(
    () =>
      calcMifflinStJeor(
        profile.sex,
        activeRecord.weightKg || profile.weightKg,
        profile.heightCm,
        profile.age,
        profile.activity
      ),
    [profile, activeRecord.weightKg]
  );

  const targetKcal = tdee + profile.goalDelta;
  const targetP = Math.round((activeRecord.weightKg || profile.weightKg) * 2.0);
  const targetF = Math.round((targetKcal * 0.25) / 9);
  const targetC = Math.max(0, Math.round((targetKcal - targetP * 4 - targetF * 9) / 4));

  // Current day telemetry
  const totals = useMemo(() => {
    return calculateDayTotals(activeItems);
  }, [activeItems]);

  // Filtered food list
  const filteredFoods = useMemo(() => {
    return foods.filter((food) => {
      const matchesSearch =
        food.name.toLowerCase().includes(search.toLowerCase()) ||
        food.category.toLowerCase().includes(search.toLowerCase());
      const matchesCategory =
        selectedCategory === 'All'
          ? true
          : selectedCategory === 'Custom'
          ? food.category === 'Custom' || food.id.startsWith('custom_')
          : food.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [foods, search, selectedCategory]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: foods.length };
    for (const f of foods) {
      const cat = f.id.startsWith('custom_') || f.category === 'Custom' ? 'Custom' : f.category;
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [foods]);

  // Helper to mutate active day record
  const updateActiveRecord = (
    updater: (prev: DayRecord) => Partial<DayRecord>
  ) => {
    setHistory((prev) => {
      const existing: DayRecord = prev[activeDate] || {
        date: activeDate,
        weightKg: profile.weightKg,
        items: [],
      };
      const changes = updater(existing);
      const updated: DayRecord = {
        ...existing,
        ...changes,
        targetKcal,
        targetP,
        targetC,
        targetF,
      };
      const nextStore = { ...prev, [activeDate]: updated };
      saveHistory(nextStore);

      if (isAuthenticated) {
        saveCloudDailyLog(updated, cloudLogIds.current[activeDate]).then((id) => {
          if (id) cloudLogIds.current[activeDate] = id;
        });
      }

      return nextStore;
    });
  };

  // Logging food item to active day
  const addFoodToLog = (food: FoodItem, grams = food.defaultGrams) => {
    updateActiveRecord((prev) => ({
      items: [
        ...prev.items,
        { uid: crypto.randomUUID(), food, grams, meal: selectedMeal },
      ],
    }));
  };

  // Gram update
  const updateGrams = (uid: string, grams: number) => {
    updateActiveRecord((prev) => ({
      items: prev.items.map((item) =>
        item.uid === uid ? { ...item, grams: Math.max(0, grams) } : item
      ),
    }));
  };

  // Delete logged item
  const removeLogItem = (uid: string) => {
    updateActiveRecord((prev) => ({
      items: prev.items.filter((item) => item.uid !== uid),
    }));
  };

  // Update morning weight for the active day
  const handleWeightChange = (newWeight: number) => {
    if (newWeight <= 0 || isNaN(newWeight)) return;
    updateActiveRecord(() => ({ weightKg: newWeight }));
    setProfile((p) => ({ ...p, weightKg: newWeight }));
  };

  // Execute Auto-Lookup from USDA / AI
  const handleTriggerAutoLookup = async (queryText: string) => {
    const query = queryText.trim();
    if (!query) {
      showNotification('Enter a food name to auto-discover macros');
      return;
    }

    setIsLookingUp(true);
    setLookupCandidates([]);

    try {
      const results = await smartDiscoverMacros(query, geminiKey, foods);
      if (results.length === 0) {
        showNotification(`No nutrition data found for "${query}"`);
      } else if (results.length === 1) {
        applyCandidate(results[0]);
        showNotification(`Auto-filled: ${results[0].p}P · ${results[0].c}C · ${results[0].f}F (${results[0].source.toUpperCase()})`);
      } else {
        setLookupCandidates(results);
        showNotification(`Found ${results.length} matches from USDA FoodData Central`);
      }
    } catch (err) {
      console.error(err);
      showNotification('Auto-lookup failed. Check connection.');
    } finally {
      setIsLookingUp(false);
    }
  };

  // Apply candidate to custom food inputs
  const applyCandidate = (cand: NutritionSearchResult) => {
    setNewFoodName(cand.name);
    setNewFoodP(String(cand.p));
    setNewFoodC(String(cand.c));
    setNewFoodF(String(cand.f));
    setNewFoodGrams(String(cand.defaultGrams));
    setLookupCandidates([]);
  };

  // Direct 1-click log from candidate
  const handleDirectLogCandidate = (cand: NutritionSearchResult, grams = cand.defaultGrams) => {
    const food: FoodItem = {
      id: cand.id,
      name: cand.name,
      category: cand.category,
      p: cand.p,
      c: cand.c,
      f: cand.f,
      defaultGrams: cand.defaultGrams,
    };
    // Save to user custom library if not exists
    if (!foods.some((f) => f.name.toLowerCase() === cand.name.toLowerCase())) {
      setFoods((prev) => [food, ...prev]);
      if (isAuthenticated) {
        saveCloudCustomFood(food);
      }
    }
    addFoodToLog(food, grams);
    setLookupCandidates([]);
    setNewFoodName('');
    showNotification(`Logged ${grams}g of "${cand.name}"`);
  };

  // Custom food submission
  const handleCreateCustomFood = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFoodName.trim()) return;
    const custom: FoodItem = {
      id: 'custom_' + Date.now(),
      name: newFoodName.trim(),
      category: 'Custom',
      p: Number(newFoodP) || 0,
      c: Number(newFoodC) || 0,
      f: Number(newFoodF) || 0,
      defaultGrams: Number(newFoodGrams) || 100,
    };
    setFoods((prev) => [custom, ...prev]);
    if (isAuthenticated) {
      saveCloudCustomFood(custom);
    }
    addFoodToLog(custom, custom.defaultGrams);
    setNewFoodName('');
    setNewFoodP('');
    setNewFoodC('');
    setNewFoodF('');
    setLookupCandidates([]);
    showNotification(`Saved and logged "${custom.name}"`);
  };

  // Confirm and log foods parsed from AI Natural Language
  const handleConfirmAILog = (loggedFoods: LoggedFood[], newFoods: FoodItem[]) => {
    // Merge any new discovered foods into library
    setFoods((prev) => {
      const existingNames = new Set(prev.map((f) => f.name.toLowerCase()));
      const toAdd = newFoods.filter((f) => !existingNames.has(f.name.toLowerCase()));
      if (isAuthenticated && toAdd.length > 0) {
        toAdd.forEach((f) => saveCloudCustomFood(f));
      }
      return [...toAdd, ...prev];
    });

    // Add logged foods into active day
    updateActiveRecord((prev) => ({
      items: [...prev.items, ...loggedFoods],
    }));

    showNotification(`Logged ${loggedFoods.length} items from AI!`);
  };

  // Auto-Balance via Cramer's Rule
  const handleAutoBalance = () => {
    const remP = Math.max(0, targetP - totals.p);
    const remC = Math.max(0, targetC - totals.c);
    const remF = Math.max(0, targetF - totals.f);

    const fP = foods.find((f) => f.id === 'chicken_breast' || f.id === 'chicken') || foods[0];
    const fC = foods.find((f) => f.id === 'white_rice') || foods[3];
    const fF = foods.find((f) => f.id === 'avocado') || foods[9];

    const sol = solveMacroDeficit3x3(fP, fC, fF, remP, remC, remF);
    if (!sol) return;

    const newEntries: LoggedFood[] = [];
    if (sol.g1 > 0)
      newEntries.push({
        uid: crypto.randomUUID(),
        food: fP,
        grams: sol.g1,
        meal: selectedMeal,
      });
    if (sol.g2 > 0)
      newEntries.push({
        uid: crypto.randomUUID(),
        food: fC,
        grams: sol.g2,
        meal: selectedMeal,
      });
    if (sol.g3 > 0)
      newEntries.push({
        uid: crypto.randomUUID(),
        food: fF,
        grams: sol.g3,
        meal: selectedMeal,
      });

    updateActiveRecord((prev) => ({
      items: [...prev.items, ...newEntries],
    }));
    showNotification(`Auto-balanced: +${sol.g1}g chicken, +${sol.g2}g rice, +${sol.g3}g avocado`);
  };

  // Clear current active day
  const handleClearActiveDay = () => {
    updateActiveRecord(() => ({ items: [] }));
    showNotification('Cleared day log');
  };

  // Export JSON backup
  const handleExportBackup = () => {
    exportBackupJSON(history, profile, foods);
    showNotification('Exported full backup JSON');
  };

  // Import JSON backup
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const raw = event.target?.result as string;
      const parsed = parseBackupJSON(raw);
      if (parsed) {
        setHistory(parsed.history);
        saveHistory(parsed.history);
        if (parsed.profile) setProfile(parsed.profile);
        if (parsed.foods) setFoods(parsed.foods);
        showNotification(
          `Restored ${Object.keys(parsed.history).length} days of history successfully!`
        );
      } else {
        alert('Invalid MacroPulse backup file.');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Generate Sample Demo History (14 days)
  const handleLoadDemoData = () => {
    const demo = generateDemoHistory(
      profile.weightKg,
      targetKcal,
      targetP,
      targetC,
      targetF
    );
    setHistory(demo);
    saveHistory(demo);
    showNotification('Loaded 14 days of realistic sample data! Check Trends.');
    setActiveTab('trends');
  };

  return (
    <div className="min-h-screen bg-[#090a0f] text-slate-100 p-4 sm:p-6 font-sans">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-emerald-950/90 border border-emerald-700 text-emerald-200 px-4 py-2.5 rounded-lg shadow-xl text-xs font-mono backdrop-blur animate-fade-in">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          {notification}
        </div>
      )}

      {/* Main Header */}
      <header className="max-w-7xl mx-auto flex flex-wrap justify-between items-center border-b border-slate-800 pb-4 mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <Utensils className="w-6 h-6 text-emerald-400" />
              MacroPulse
            </h1>
            <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/70 px-2 py-0.5 rounded border border-emerald-800">
              v2.2 Auto-Nutrition Engine
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono mt-1">
            BMR: {bmr} kcal | TDEE: {tdee} kcal | Target: {targetKcal} kcal ({targetP}P /{' '}
            {targetC}C / {targetF}F)
          </p>
        </div>

        {/* Tab Switcher & Quick Actions */}
        <div className="flex items-center gap-2">
          {isAuthenticated ? (
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg">
              {isCloudSyncing ? (
                <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
              ) : (
                <Cloud className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span className="text-xs font-mono text-slate-300 truncate max-w-[130px]" title={userEmail || 'Account'}>
                {userEmail || 'Account'}
              </span>
              <button
                onClick={() => logout()}
                className="text-[10px] font-mono text-slate-500 hover:text-rose-400 ml-1 transition"
                title="Sign Out"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-xs font-mono font-medium flex items-center gap-1.5 transition"
            >
              <Cloud className="w-3.5 h-3.5 text-indigo-400" />
              Sign In / AWS Sync
            </button>
          )}

          <div className="bg-slate-950 p-1 rounded-lg border border-slate-800 flex items-center gap-1">
            <button
              onClick={() => setActiveTab('logger')}
              className={`px-3 py-1.5 rounded text-xs font-mono font-medium transition ${
                activeTab === 'logger'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Daily Logger
            </button>
            <button
              onClick={() => setActiveTab('trends')}
              className={`px-3 py-1.5 rounded text-xs font-mono font-medium flex items-center gap-1.5 transition ${
                activeTab === 'trends'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Trends & History
            </button>
            <button
              onClick={() => setActiveTab('data')}
              className={`px-3 py-1.5 rounded text-xs font-mono font-medium flex items-center gap-1.5 transition ${
                activeTab === 'data'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              Data & Settings
            </button>
          </div>
        </div>
      </header>

      {/* VIEW: DAILY LOGGER */}
      {activeTab === 'logger' && (
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Day Navigation & Daily Weigh-in Banner */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-wrap justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveDate((d) => shiftDate(d, -1))}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 transition"
                title="Previous Day"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg">
                <Calendar className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-mono font-semibold text-slate-200">
                  {formatDisplayDate(activeDate)}
                </span>
                <input
                  type="date"
                  value={activeDate}
                  onChange={(e) => e.target.value && setActiveDate(e.target.value)}
                  className="bg-transparent text-slate-400 text-xs font-mono focus:outline-none cursor-pointer w-5 overflow-hidden"
                />
              </div>

              <button
                onClick={() => setActiveDate((d) => shiftDate(d, 1))}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 transition"
                title="Next Day"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {activeDate !== getTodayDate() && (
                <button
                  onClick={() => setActiveDate(getTodayDate())}
                  className="px-2.5 py-1 text-xs font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800 rounded hover:bg-emerald-900 transition"
                >
                  Jump to Today
                </button>
              )}
            </div>

            {/* Morning Weight & Actions */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 border border-slate-800 rounded-lg">
                <Scale className="w-4 h-4 text-indigo-400" />
                <span className="text-xs text-slate-400 font-mono">Weight:</span>
                <input
                  type="number"
                  step="0.1"
                  value={activeRecord.weightKg || profile.weightKg}
                  onChange={(e) => handleWeightChange(Number(e.target.value))}
                  className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-mono text-right text-white font-bold"
                />
                <span className="text-xs font-mono text-slate-500">kg</span>
              </div>

              <button
                onClick={() => setIsAIMealModalOpen(true)}
                className="px-3 py-1.5 text-xs font-mono font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg transition flex items-center gap-1.5 shadow-md shadow-indigo-950"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                AI Log Meal
              </button>
              <button
                onClick={() => setIsBarcodeModalOpen(true)}
                className="px-3 py-1.5 text-xs font-mono font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg transition flex items-center gap-1.5"
              >
                <ScanBarcode className="w-3.5 h-3.5 text-indigo-300" />
                Scan Barcode
              </button>
              <button
                onClick={handleAutoBalance}
                className="px-3 py-1.5 text-xs font-mono bg-indigo-600 hover:bg-indigo-500 text-white rounded transition"
              >
                Auto-Solve Deficit (Ax = b)
              </button>
              <button
                onClick={handleClearActiveDay}
                className="px-3 py-1.5 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition"
              >
                Clear Day
              </button>
            </div>
          </div>

          <main className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Food Library & Custom Food Creator */}
            <section className="lg:col-span-5 space-y-4">
              {/* Quick AI Natural Language Callout */}
              <button
                type="button"
                onClick={() => setIsAIMealModalOpen(true)}
                className="w-full py-2.5 px-3.5 bg-gradient-to-r from-indigo-950/80 via-purple-950/60 to-indigo-950/80 border border-indigo-700/60 hover:border-indigo-500 rounded-xl text-xs font-mono text-indigo-200 hover:text-white flex items-center justify-between transition group shadow-md shadow-indigo-950/40"
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-300 group-hover:rotate-12 transition-transform" />
                  <span className="font-semibold text-white">AI Natural Language Meal Logger</span>
                </span>
                <span className="text-[10px] bg-indigo-800/80 px-2 py-0.5 rounded text-indigo-200 font-bold">
                  Voice or Text →
                </span>
              </button>

              <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                    Food Library ({filteredFoods.length} items)
                  </h2>
                  <select
                    value={selectedMeal}
                    onChange={(e) =>
                      setSelectedMeal(
                        e.target.value as 'breakfast' | 'lunch' | 'dinner' | 'snacks'
                      )
                    }
                    className="bg-slate-800 text-xs font-mono text-emerald-400 px-2.5 py-1 rounded border border-slate-700"
                  >
                    <option value="breakfast">Log to: Breakfast</option>
                    <option value="lunch">Log to: Lunch</option>
                    <option value="dinner">Log to: Dinner</option>
                    <option value="snacks">Log to: Snacks</option>
                  </select>
                </div>

                {/* Category Filter Pills */}
                <div className="flex gap-1.5 overflow-x-auto pb-2.5 mb-2.5 scrollbar-thin">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-mono whitespace-nowrap transition flex items-center gap-1 ${
                        selectedCategory === cat
                          ? 'bg-emerald-600 text-white font-bold'
                          : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      {cat}
                      {categoryCounts[cat] !== undefined && (
                        <span className="text-[9px] opacity-70">
                          ({categoryCounts[cat]})
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="relative mb-3">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search 65+ foods (chicken, rice, dumplings, avocado)..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Quick Auto-Lookup Banner if searched query not in library or to query USDA */}
                {search.trim().length > 1 && (
                  <div className="mb-3 p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-800/60 flex items-center justify-between gap-2">
                    <div className="text-xs text-indigo-300">
                      <span className="font-semibold">Looking for &quot;{search}&quot;?</span>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Query official USDA FoodData Central & AI
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setNewFoodName(search);
                        handleTriggerAutoLookup(search);
                      }}
                      disabled={isLookingUp}
                      className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-mono flex items-center gap-1.5 whitespace-nowrap transition disabled:opacity-50"
                    >
                      {isLookingUp ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3 text-amber-300" />
                      )}
                      ✨ Auto-Lookup
                    </button>
                  </div>
                )}

                <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                  {filteredFoods.length === 0 ? (
                    <div className="text-center py-6 text-slate-500 text-xs">
                      No foods matched &quot;{search}&quot;.
                      <button
                        onClick={() => {
                          setNewFoodName(search);
                          handleTriggerAutoLookup(search);
                        }}
                        className="block mx-auto mt-2 text-indigo-400 hover:text-indigo-300 underline font-mono"
                      >
                        ✨ Search USDA Database for &quot;{search}&quot;
                      </button>
                    </div>
                  ) : (
                    filteredFoods.map((food) => (
                      <div
                        key={food.id}
                        className="flex justify-between items-center p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 hover:border-slate-700"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-slate-200">
                              {food.name}
                            </span>
                            <span className="text-[9px] font-mono uppercase px-1 py-0.2 rounded bg-slate-800/80 text-slate-400">
                              {food.category}
                            </span>
                          </div>
                          <div className="text-xs font-mono text-slate-400 mt-0.5">
                            {Math.round(calcKcal(food.p, food.c, food.f))} kcal |{' '}
                            <span className="text-emerald-400">{food.p}g P</span> ·{' '}
                            <span className="text-amber-400">{food.c}g C</span> ·{' '}
                            <span className="text-rose-400">{food.f}g F</span>
                          </div>
                        </div>
                        <button
                          onClick={() => addFoodToLog(food)}
                          className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 rounded text-xs font-mono"
                        >
                          + {food.defaultGrams}g
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Custom Food Form with Auto-Fill Feature */}
              <form
                onSubmit={handleCreateCustomFood}
                className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3"
              >
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    Smart Custom Food (Auto-Fill)
                  </h3>
                  <span className="text-[10px] text-slate-500 font-mono">
                    USDA & AI Powered
                  </span>
                </div>

                {/* Name input with Auto-Fill button */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter any food (e.g. Salmon fillet, Greek yogurt, Dumplings)..."
                    value={newFoodName}
                    onChange={(e) => setNewFoodName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !newFoodP && newFoodName.trim()) {
                        e.preventDefault();
                        handleTriggerAutoLookup(newFoodName);
                      }
                    }}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => handleTriggerAutoLookup(newFoodName)}
                    disabled={isLookingUp || !newFoodName.trim()}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-mono flex items-center gap-1.5 transition disabled:opacity-50 whitespace-nowrap"
                    title="Automatically find nutrition facts from official USDA database"
                  >
                    {isLookingUp ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                    )}
                    Auto-Fill
                  </button>
                </div>

                {/* Candidate Selection Dropdown if multiple found */}
                {lookupCandidates.length > 0 && (
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-indigo-800/80 space-y-2">
                    <div className="text-[11px] font-mono text-indigo-300 flex justify-between items-center">
                      <span>Select matching USDA food item:</span>
                      <button
                        type="button"
                        onClick={() => setLookupCandidates([])}
                        className="text-slate-500 hover:text-slate-300 text-xs"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {lookupCandidates.map((cand) => (
                        <div
                          key={cand.id}
                          className="p-2 rounded bg-slate-900 border border-slate-800 hover:border-indigo-500/70 transition flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs text-white font-medium truncate">
                              {cand.name}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                              {cand.kcal} kcal |{' '}
                              <span className="text-emerald-400">{cand.p}g P</span> ·{' '}
                              <span className="text-amber-400">{cand.c}g C</span> ·{' '}
                              <span className="text-rose-400">{cand.f}g F</span>{' '}
                              <span className="text-slate-500">/ 100g</span>
                              {cand.brand && (
                                <span className="ml-1 text-slate-500">({cand.brand})</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => applyCandidate(cand)}
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono whitespace-nowrap"
                            >
                              Fill Inputs
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDirectLogCandidate(cand)}
                              className="px-2 py-1 bg-emerald-600/30 hover:bg-emerald-600/60 text-emerald-300 border border-emerald-500/40 rounded text-[10px] font-mono whitespace-nowrap"
                            >
                              + Log
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Macro Inputs */}
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400 font-mono block mb-0.5">
                      Protein (g)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="P (g)"
                      value={newFoodP}
                      onChange={(e) => setNewFoodP(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-emerald-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-mono block mb-0.5">
                      Carbs (g)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="C (g)"
                      value={newFoodC}
                      onChange={(e) => setNewFoodC(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-amber-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-mono block mb-0.5">
                      Fat (g)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="F (g)"
                      value={newFoodF}
                      onChange={(e) => setNewFoodF(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-rose-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-mono block mb-0.5">
                      Portion (g)
                    </label>
                    <input
                      type="number"
                      placeholder="Grams"
                      value={newFoodGrams}
                      onChange={(e) => setNewFoodGrams(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs rounded transition flex items-center justify-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  Save & Log Custom Food
                </button>
              </form>
            </section>

            {/* Right Column: Live Macro Telemetry & Meal Buckets */}
            <section className="lg:col-span-7 space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-900/70 border border-slate-800 rounded-xl p-4">
                <div>
                  <span className="text-xs text-slate-400">Calories</span>
                  <div className="text-lg font-mono font-bold">
                    {Math.round(totals.kcal)}{' '}
                    <span className="text-xs text-slate-500">/ {targetKcal}</span>
                  </div>
                </div>
                <div>
                  <span className="text-xs text-emerald-400">Protein</span>
                  <div className="text-lg font-mono font-bold">
                    {totals.p.toFixed(1)}g{' '}
                    <span className="text-xs text-slate-500">/ {targetP}g</span>
                  </div>
                </div>
                <div>
                  <span className="text-xs text-amber-400">Carbs</span>
                  <div className="text-lg font-mono font-bold">
                    {totals.c.toFixed(1)}g{' '}
                    <span className="text-xs text-slate-500">/ {targetC}g</span>
                  </div>
                </div>
                <div>
                  <span className="text-xs text-rose-400">Fats</span>
                  <div className="text-lg font-mono font-bold">
                    {totals.f.toFixed(1)}g{' '}
                    <span className="text-xs text-slate-500">/ {targetF}g</span>
                  </div>
                </div>
              </div>

              {/* Profile Config Row */}
              <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-6 gap-3">
                <label className="text-xs text-slate-400">
                  Sex
                  <select
                    value={profile.sex}
                    onChange={(e) =>
                      setProfile((p) => ({
                        ...p,
                        sex: e.target.value as 'male' | 'female',
                      }))
                    }
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-sm text-white"
                  >
                    <option value="male">Male (+5)</option>
                    <option value="female">Female (-161)</option>
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Height (cm)
                  <input
                    type="number"
                    value={profile.heightCm}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, heightCm: Number(e.target.value) }))
                    }
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-sm text-white"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Age
                  <input
                    type="number"
                    value={profile.age}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, age: Number(e.target.value) }))
                    }
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-sm text-white"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Activity
                  <select
                    value={profile.activity}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, activity: Number(e.target.value) }))
                    }
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-sm text-white"
                  >
                    <option value={1.2}>1.2x Desk</option>
                    <option value={1.375}>1.375x Light</option>
                    <option value={1.55}>1.55x Court Sports</option>
                    <option value={1.725}>1.725x Heavy</option>
                  </select>
                </label>
                <label className="text-xs text-slate-400 col-span-2">
                  Goal Offset
                  <select
                    value={profile.goalDelta}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, goalDelta: Number(e.target.value) }))
                    }
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-sm text-white"
                  >
                    <option value={-400}>Cut (-400 kcal)</option>
                    <option value={0}>Maintenance (0 kcal)</option>
                    <option value={300}>Lean Bulk (+300 kcal)</option>
                  </select>
                </label>
              </div>

              {/* Logged items */}
              <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                  Logged for {formatDisplayDate(activeDate)} ({activeItems.length})
                </h2>
                {activeItems.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">
                    No foods logged for this date yet. Click &quot;+ Grams&quot; on any food or click &quot;Auto-Solve Deficit&quot;.
                  </p>
                ) : (
                  activeItems.map((entry) => {
                    const r = entry.grams / 100;
                    const p = entry.food.p * r;
                    const c = entry.food.c * r;
                    const f = entry.food.f * r;
                    return (
                      <div
                        key={entry.uid}
                        className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div>
                          <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 mr-2">
                            {entry.meal}
                          </span>
                          <span className="text-sm font-medium">
                            {entry.food.name}
                          </span>
                          <div className="text-xs font-mono text-slate-400 mt-1">
                            {Math.round(calcKcal(p, c, f))} kcal · {p.toFixed(1)}P ·{' '}
                            {c.toFixed(1)}C · {f.toFixed(1)}F
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={0}
                            max={500}
                            step={5}
                            value={entry.grams}
                            onChange={(e) =>
                              updateGrams(entry.uid, Number(e.target.value))
                            }
                            className="w-28 accent-indigo-500"
                          />
                          <input
                            type="number"
                            value={entry.grams}
                            onChange={(e) =>
                              updateGrams(entry.uid, Number(e.target.value))
                            }
                            className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-right"
                          />
                          <span className="text-xs font-mono text-slate-500">
                            g
                          </span>
                          <button
                            onClick={() => removeLogItem(entry.uid)}
                            className="text-slate-500 hover:text-rose-400 text-xs px-1.5"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </main>
        </div>
      )}

      {/* VIEW: TRENDS & ANALYTICS */}
      {activeTab === 'trends' && (
        <div className="max-w-7xl mx-auto">
          <TrendCharts
            history={history}
            profile={profile}
            targetKcal={targetKcal}
            targetP={targetP}
            targetC={targetC}
            targetF={targetF}
            onSelectDate={(d) => {
              setActiveDate(d);
              setActiveTab('logger');
            }}
          />
        </div>
      )}

      {/* VIEW: DATA & SETTINGS */}
      {activeTab === 'data' && (
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-6 space-y-6">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Database className="w-5 h-5 text-indigo-400" />
                Data Portability & Settings
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Your meals, daily weigh-ins, and foods are saved securely in your browser&apos;s local storage.
                Use the controls below to configure AI macro lookup, export backups, or preview sample trends.
              </p>
            </div>

            {/* AI Estimation Config Card */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center gap-2 text-white font-medium text-sm">
                <Key className="w-4 h-4 text-amber-400" />
                Google Gemini API Key (Optional for Complex Recipe Estimation)
              </div>
              <p className="text-xs text-slate-400">
                MacroPulse automatically queries the official <strong>USDA FoodData Central database</strong> with zero setup.
                If you want AI to estimate multi-ingredient recipes or complex restaurant dishes (e.g., &quot;grandma&apos;s beef brisket with potatoes&quot;), paste a free Gemini API key from Google AI Studio.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="Paste Gemini API key (e.g. AIzaSy...)"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={() => handleSaveGeminiKey(keyInput)}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-mono transition"
                >
                  Save Key
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Export Backup */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-white font-medium text-sm">
                  <Download className="w-4 h-4 text-emerald-400" />
                  Export Full Backup
                </div>
                <p className="text-xs text-slate-400">
                  Download a complete JSON snapshot of your entire history ({Object.keys(history).length} days logged), profile, and custom foods.
                </p>
                <button
                  onClick={handleExportBackup}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs rounded transition flex items-center justify-center gap-2 mt-2"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Backup (.json)
                </button>
              </div>

              {/* Import Backup */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-white font-medium text-sm">
                  <Upload className="w-4 h-4 text-indigo-400" />
                  Restore / Import Backup
                </div>
                <p className="text-xs text-slate-400">
                  Load a previously exported backup file to restore history or transfer data between devices.
                </p>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".json"
                  onChange={handleImportFile}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs rounded transition flex items-center justify-center gap-2 mt-2"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Select Backup File
                </button>
              </div>
            </div>

            {/* Demo Data Generator */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <div className="flex items-center gap-2 text-white font-medium text-sm">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  Load Sample 14-Day History
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Populate 14 days of realistic meal logs and weight progress to immediately preview the analytics and charts.
                </p>
              </div>
              <button
                onClick={handleLoadDemoData}
                className="px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/40 rounded text-xs font-mono whitespace-nowrap transition"
              >
                Load Sample Data
              </button>
            </div>

            {/* Clear All Storage */}
            <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-900/40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <div className="flex items-center gap-2 text-rose-300 font-medium text-sm">
                  <RotateCcw className="w-4 h-4 text-rose-400" />
                  Reset Local Storage
                </div>
                <p className="text-xs text-rose-400/70 mt-0.5">
                  Permanently delete all stored historical days and reset back to defaults.
                </p>
              </div>
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to reset all stored history?')) {
                    localStorage.removeItem('mp_history_v1');
                    localStorage.removeItem('mp_log');
                    setHistory({});
                    showNotification('History reset');
                  }
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-mono whitespace-nowrap transition"
              >
                Clear All Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Natural Language Meal Logger Modal */}
      <AIMealModal
        isOpen={isAIMealModalOpen}
        onClose={() => setIsAIMealModalOpen(false)}
        defaultMeal={selectedMeal}
        foodLibrary={foods}
        geminiKey={geminiKey}
        onSaveGeminiKey={handleSaveGeminiKey}
        onConfirmLog={handleConfirmAILog}
      />

      {/* Barcode Scanner (Open Food Facts) Modal */}
      <BarcodeScannerModal
        isOpen={isBarcodeModalOpen}
        onClose={() => setIsBarcodeModalOpen(false)}
        onConfirmLog={(product, grams) => {
          handleDirectLogCandidate(product, grams);
          setIsBarcodeModalOpen(false);
        }}
      />

      {/* AWS Cognito Auth & Cloud Sync Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onLoginSuccess={(email) => {
          showNotification(`Signed in as ${email}!`);
        }}
      />
    </div>
  );
}
