import type { HistoryStore, UserProfile } from './types';
import type { FoodItem, LoggedFood } from './mathEngine';
import { calcKcal } from './mathEngine';
import { DEFAULT_FOODS } from './foodDb';

const STORAGE_KEYS = {
  HISTORY: 'mp_history_v1',
  PROFILE: 'mp_profile_v1',
  FOODS: 'mp_foods',
  LEGACY_LOG: 'mp_log',
};

export const formatISODate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getTodayDate = (): string => {
  return formatISODate(new Date());
};

export const shiftDate = (dateStr: string, days: number): string => {
  const parts = dateStr.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + days);
  return formatISODate(d);
};

export const formatDisplayDate = (dateStr: string): string => {
  const today = getTodayDate();
  const yesterday = shiftDate(today, -1);
  const tomorrow = shiftDate(today, 1);

  const parts = dateStr.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const formatted = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  if (dateStr === today) return `Today · ${formatted}`;
  if (dateStr === yesterday) return `Yesterday · ${formatted}`;
  if (dateStr === tomorrow) return `Tomorrow · ${formatted}`;
  return formatted;
};

export const DEFAULT_PROFILE: UserProfile = {
  sex: 'male',
  weightKg: 72,
  heightCm: 178,
  age: 21,
  activity: 1.55,
  goalDelta: 0,
};

export const loadProfile = (): UserProfile => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PROFILE);
    if (!raw) return DEFAULT_PROFILE;
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PROFILE;
  }
};

export const saveProfile = (profile: UserProfile): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(profile));
  } catch (err) {
    console.error('Failed to save profile', err);
  }
};

export const loadHistory = (defaultWeight = 72): HistoryStore => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HISTORY);
    let history: HistoryStore = raw ? JSON.parse(raw) : {};

    // Check for legacy single-day log migration
    const legacyRaw = localStorage.getItem(STORAGE_KEYS.LEGACY_LOG);
    if (legacyRaw && Object.keys(history).length === 0) {
      const legacyItems: LoggedFood[] = JSON.parse(legacyRaw);
      if (Array.isArray(legacyItems) && legacyItems.length > 0) {
        const today = getTodayDate();
        history[today] = {
          date: today,
          weightKg: defaultWeight,
          items: legacyItems,
        };
        localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
      }
    }

    return history;
  } catch {
    return {};
  }
};

export const saveHistory = (history: HistoryStore): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
  } catch (err) {
    console.error('Failed to save history', err);
  }
};

export const calculateDayTotals = (items: LoggedFood[]) => {
  return items.reduce(
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
};

export const exportBackupJSON = (
  history: HistoryStore,
  profile: UserProfile,
  foods: FoodItem[]
): void => {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    profile,
    foods,
    history,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `macropulse-backup-${getTodayDate()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

export interface BackupPayload {
  version: number;
  exportedAt: string;
  profile?: UserProfile;
  foods?: FoodItem[];
  history: HistoryStore;
}

export const parseBackupJSON = (raw: string): BackupPayload | null => {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (!data.history || typeof data.history !== 'object') return null;
    return data as BackupPayload;
  } catch {
    return null;
  }
};

export const generateDemoHistory = (
  baseWeight = 73.2,
  targetKcal = 2500,
  targetP = 144,
  targetC = 300,
  targetF = 69
): HistoryStore => {
  const store: HistoryStore = {};
  const today = getTodayDate();
  const chicken = DEFAULT_FOODS.find((f) => f.id === 'chicken') || DEFAULT_FOODS[0];
  const rice = DEFAULT_FOODS.find((f) => f.id === 'white_rice') || DEFAULT_FOODS[3];
  const beef = DEFAULT_FOODS.find((f) => f.id === 'braised_beef') || DEFAULT_FOODS[1];
  const oats = DEFAULT_FOODS.find((f) => f.id === 'oats') || DEFAULT_FOODS[8];
  const eggs = DEFAULT_FOODS.find((f) => f.id === 'eggs') || DEFAULT_FOODS[6];
  const whey = DEFAULT_FOODS.find((f) => f.id === 'whey') || DEFAULT_FOODS[7];
  const avocado = DEFAULT_FOODS.find((f) => f.id === 'avocado') || DEFAULT_FOODS[9];

  // 14 days of realistic meal logs and steady weight trajectory
  for (let i = 13; i >= 0; i--) {
    const dStr = shiftDate(today, -i);
    // Slight downward weight slope (-0.05kg per day with minor water weight noise)
    const weight = Math.round((baseWeight - (13 - i) * 0.07 + (Math.random() * 0.4 - 0.2)) * 10) / 10;

    // Macro intake variation (some days slight deficit, some days right on target)
    const variance = (Math.sin(i * 1.5) * 0.12);
    const chickenG = Math.round(180 * (1 + variance));
    const riceG = Math.round(240 * (1 + variance * 0.8));
    const oatsG = 80;
    const eggsG = 120;
    const beefG = i % 2 === 0 ? 150 : 0;
    const wheyG = 35;
    const avoG = 75;

    const items: LoggedFood[] = [
      { uid: `demo_${dStr}_1`, food: oats, grams: oatsG, meal: 'breakfast' },
      { uid: `demo_${dStr}_2`, food: eggs, grams: eggsG, meal: 'breakfast' },
      { uid: `demo_${dStr}_3`, food: chicken, grams: chickenG, meal: 'lunch' },
      { uid: `demo_${dStr}_4`, food: rice, grams: riceG, meal: 'lunch' },
      { uid: `demo_${dStr}_5`, food: whey, grams: wheyG, meal: 'snacks' },
    ];

    if (beefG > 0) {
      items.push({ uid: `demo_${dStr}_6`, food: beef, grams: beefG, meal: 'dinner' });
    } else {
      items.push({ uid: `demo_${dStr}_6`, food: chicken, grams: 160, meal: 'dinner' });
      items.push({ uid: `demo_${dStr}_7`, food: avocado, grams: avoG, meal: 'dinner' });
    }

    store[dStr] = {
      date: dStr,
      weightKg: weight,
      items,
      targetKcal,
      targetP,
      targetC,
      targetF,
    };
  }

  return store;
};
