import { useState, useEffect, useMemo } from 'react';
import { DEFAULT_FOODS } from './foodDb';
import {
  calcKcal,
  calcMifflinStJeor,
  solveMacroDeficit3x3,
} from './mathEngine';
import type { FoodItem, LoggedFood } from './mathEngine';

export default function App() {
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [weightKg, setWeightKg] = useState(72);
  const [heightCm, setHeightCm] = useState(178);
  const [age, setAge] = useState(21);
  const [activity, setActivity] = useState(1.55);
  const [goalDelta, setGoalDelta] = useState(0);

  const [foods, setFoods] = useState<FoodItem[]>(() => {
    const saved = localStorage.getItem('mp_foods');
    return saved ? JSON.parse(saved) : DEFAULT_FOODS;
  });

  const [log, setLog] = useState<LoggedFood[]>(() => {
    const saved = localStorage.getItem('mp_log');
    return saved ? JSON.parse(saved) : [];
  });

  const [selectedMeal, setSelectedMeal] = useState<'breakfast' | 'lunch' | 'dinner' | 'snacks'>('lunch');
  const [search, setSearch] = useState('');

  // Custom Food Creator State
  const [newFoodName, setNewFoodName] = useState('');
  const [newFoodP, setNewFoodP] = useState('');
  const [newFoodC, setNewFoodC] = useState('');
  const [newFoodF, setNewFoodF] = useState('');
  const [newFoodGrams, setNewFoodGrams] = useState('100');

  useEffect(() => {
    localStorage.setItem('mp_foods', JSON.stringify(foods));
  }, [foods]);

  useEffect(() => {
    localStorage.setItem('mp_log', JSON.stringify(log));
  }, [log]);

  const { bmr, tdee } = useMemo(
    () => calcMifflinStJeor(sex, weightKg, heightCm, age, activity),
    [sex, weightKg, heightCm, age, activity]
  );

  const targetKcal = tdee + goalDelta;
  const targetP = Math.round(weightKg * 2.0);
  const targetF = Math.round((targetKcal * 0.25) / 9);
  const targetC = Math.max(0, Math.round((targetKcal - targetP * 4 - targetF * 9) / 4));

  const totals = useMemo(() => {
    return log.reduce(
      (acc, item) => {
        const ratio = item.grams / 100;
        const p = item.food.p * ratio;
        const c = item.food.c * ratio;
        const f = item.food.f * ratio;
        acc.p += p;
        acc.c += c;
        acc.f += f;
        acc.kcal += calcKcal(p, c, f);
        return acc;
      },
      { p: 0, c: 0, f: 0, kcal: 0 }
    );
  }, [log]);

  const addFoodToLog = (food: FoodItem, grams = food.defaultGrams) => {
    setLog((prev) => [
      ...prev,
      { uid: crypto.randomUUID(), food, grams, meal: selectedMeal },
    ]);
  };

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
    addFoodToLog(custom, custom.defaultGrams);
    setNewFoodName('');
    setNewFoodP('');
    setNewFoodC('');
    setNewFoodF('');
  };

  const updateGrams = (uid: string, grams: number) => {
    setLog((prev) =>
      prev.map((item) => (item.uid === uid ? { ...item, grams: Math.max(0, grams) } : item))
    );
  };

  const removeLogItem = (uid: string) => {
    setLog((prev) => prev.filter((item) => item.uid !== uid));
  };

  const handleAutoBalance = () => {
    const remP = Math.max(0, targetP - totals.p);
    const remC = Math.max(0, targetC - totals.c);
    const remF = Math.max(0, targetF - totals.f);

    const fP = foods.find((f) => f.id === 'chicken') || foods[0];
    const fC = foods.find((f) => f.id === 'white_rice') || foods[3];
    const fF = foods.find((f) => f.id === 'avocado') || foods[9];

    const sol = solveMacroDeficit3x3(fP, fC, fF, remP, remC, remF);
    if (!sol) return;

    const newEntries: LoggedFood[] = [];
    if (sol.g1 > 0) newEntries.push({ uid: crypto.randomUUID(), food: fP, grams: sol.g1, meal: selectedMeal });
    if (sol.g2 > 0) newEntries.push({ uid: crypto.randomUUID(), food: fC, grams: sol.g2, meal: selectedMeal });
    if (sol.g3 > 0) newEntries.push({ uid: crypto.randomUUID(), food: fF, grams: sol.g3, meal: selectedMeal });

    setLog((prev) => [...prev, ...newEntries]);
  };

  return (
    <div className="min-h-screen bg-[#090a0f] text-slate-100 p-6 font-sans">
      <header className="max-w-7xl mx-auto flex flex-wrap justify-between items-center border-b border-slate-800 pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            MacroPulse <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">v2.0 Linear Engine</span>
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-1">
            BMR: {bmr} kcal | TDEE: {tdee} kcal | Target: {targetKcal} kcal ({targetP}P / {targetC}C / {targetF}F)
          </p>
        </div>

        <div className="flex gap-2 mt-3 sm:mt-0">
          <button
            onClick={handleAutoBalance}
            className="px-3 py-1.5 text-xs font-mono bg-indigo-600 hover:bg-indigo-500 text-white rounded transition"
          >
            Auto-Solve Deficit (Ax = b)
          </button>
          <button
            onClick={() => setLog([])}
            className="px-3 py-1.5 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition"
          >
            Clear Day
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Food Database & Custom Food Creator */}
        <section className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Food Library (Per 100g)</h2>
              <select
                value={selectedMeal}
                onChange={(e) => setSelectedMeal(e.target.value as 'breakfast' | 'lunch' | 'dinner' | 'snacks')}
                className="bg-slate-800 text-xs font-mono text-emerald-400 px-2.5 py-1 rounded border border-slate-700"
              >
                <option value="breakfast">Log to: Breakfast</option>
                <option value="lunch">Log to: Lunch</option>
                <option value="dinner">Log to: Dinner</option>
                <option value="snacks">Log to: Snacks</option>
              </select>
            </div>

            <input
              type="text"
              placeholder="Filter foods (e.g., braised beef, millet, tofu)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:border-indigo-500"
            />

            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {foods
                .filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
                .map((food) => (
                  <div
                    key={food.id}
                    className="flex justify-between items-center p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 hover:border-slate-700"
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-200">{food.name}</div>
                      <div className="text-xs font-mono text-slate-400">
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
                ))}
            </div>
          </div>

          {/* Custom Food Form */}
          <form onSubmit={handleCreateCustomFood} className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Add Custom Food (Per 100g)</h3>
            <input
              type="text"
              placeholder="Food name (e.g., Homemade Dumplings)"
              value={newFoodName}
              onChange={(e) => setNewFoodName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-sm"
              required
            />
            <div className="grid grid-cols-4 gap-2">
              <input
                type="number"
                step="0.1"
                placeholder="P (g)"
                value={newFoodP}
                onChange={(e) => setNewFoodP(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono"
              />
              <input
                type="number"
                step="0.1"
                placeholder="C (g)"
                value={newFoodC}
                onChange={(e) => setNewFoodC(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono"
              />
              <input
                type="number"
                step="0.1"
                placeholder="F (g)"
                value={newFoodF}
                onChange={(e) => setNewFoodF(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono"
              />
              <input
                type="number"
                placeholder="Portion(g)"
                value={newFoodGrams}
                onChange={(e) => setNewFoodGrams(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono"
              />
            </div>
            <button
              type="submit"
              className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs rounded transition"
            >
              + Save & Log Custom Food
            </button>
          </form>
        </section>

        {/* Right Column: Live Macro Telemetry & Meal Buckets */}
        <section className="lg:col-span-7 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-900/70 border border-slate-800 rounded-xl p-4">
            <div>
              <span className="text-xs text-slate-400">Calories</span>
              <div className="text-lg font-mono font-bold">
                {Math.round(totals.kcal)} <span className="text-xs text-slate-500">/ {targetKcal}</span>
              </div>
            </div>
            <div>
              <span className="text-xs text-emerald-400">Protein</span>
              <div className="text-lg font-mono font-bold">
                {totals.p.toFixed(1)}g <span className="text-xs text-slate-500">/ {targetP}g</span>
              </div>
            </div>
            <div>
              <span className="text-xs text-amber-400">Carbs</span>
              <div className="text-lg font-mono font-bold">
                {totals.c.toFixed(1)}g <span className="text-xs text-slate-500">/ {targetC}g</span>
              </div>
            </div>
            <div>
              <span className="text-xs text-rose-400">Fats</span>
              <div className="text-lg font-mono font-bold">
                {totals.f.toFixed(1)}g <span className="text-xs text-slate-500">/ {targetF}g</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-6 gap-3">
            <label className="text-xs text-slate-400">
              Sex
              <select
                value={sex}
                onChange={(e) => setSex(e.target.value as 'male' | 'female')}
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-sm text-white"
              >
                <option value="male">Male (+5)</option>
                <option value="female">Female (-161)</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Weight (kg)
              <input
                type="number"
                value={weightKg}
                onChange={(e) => setWeightKg(Number(e.target.value))}
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400">
              Height (cm)
              <input
                type="number"
                value={heightCm}
                onChange={(e) => setHeightCm(Number(e.target.value))}
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400">
              Age
              <input
                type="number"
                value={age}
                onChange={(e) => setAge(Number(e.target.value))}
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400">
              Activity
              <select
                value={activity}
                onChange={(e) => setActivity(Number(e.target.value))}
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-sm text-white"
              >
                <option value={1.2}>1.2x Desk</option>
                <option value={1.375}>1.375x Light</option>
                <option value={1.55}>1.55x Court Sports</option>
                <option value={1.725}>1.725x Heavy</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Goal Offset
              <select
                value={goalDelta}
                onChange={(e) => setGoalDelta(Number(e.target.value))}
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-sm text-white"
              >
                <option value={-400}>Cut (-400)</option>
                <option value={0}>Maint (0)</option>
                <option value={300}>Lean Bulk (+300)</option>
              </select>
            </label>
          </div>

          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Logged Items ({log.length})
            </h2>
            {log.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                Click &quot;+ Grams&quot; on any food in the left library or click &quot;Auto-Solve Deficit&quot; above.
              </p>
            ) : (
              log.map((entry) => {
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
                      <span className="text-sm font-medium">{entry.food.name}</span>
                      <div className="text-xs font-mono text-slate-400 mt-1">
                        {Math.round(calcKcal(p, c, f))} kcal · {p.toFixed(1)}P · {c.toFixed(1)}C · {f.toFixed(1)}F
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={500}
                        step={5}
                        value={entry.grams}
                        onChange={(e) => updateGrams(entry.uid, Number(e.target.value))}
                        className="w-28 accent-indigo-500"
                      />
                      <input
                        type="number"
                        value={entry.grams}
                        onChange={(e) => updateGrams(entry.uid, Number(e.target.value))}
                        className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-right"
                      />
                      <span className="text-xs font-mono text-slate-500">g</span>
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
  );
}
