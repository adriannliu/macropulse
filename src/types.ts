import type { LoggedFood } from './mathEngine';

export interface DayRecord {
  date: string; // 'YYYY-MM-DD'
  weightKg: number;
  items: LoggedFood[];
  targetKcal?: number;
  targetP?: number;
  targetC?: number;
  targetF?: number;
  notes?: string;
}

export type HistoryStore = Record<string, DayRecord>;

export interface UserProfile {
  sex: 'male' | 'female';
  weightKg: number;
  heightCm: number;
  age: number;
  activity: number;
  goalDelta: number;
}

export interface DayTotals {
  p: number;
  c: number;
  f: number;
  kcal: number;
}
