import { generateClient } from 'aws-amplify/data';
import { isAmplifyConfigured } from './auth';
import type { UserProfile, DayRecord } from './types';
import type { FoodItem } from './mathEngine';

let dataClient: any = null;

function getDataClient() {
  if (!isAmplifyConfigured) return null;
  if (!dataClient) {
    try {
      dataClient = generateClient();
    } catch {
      return null;
    }
  }
  return dataClient;
}

/**
 * Fetch remote UserProfile for the current authenticated user.
 */
export async function fetchCloudProfile(): Promise<{ id: string; profile: UserProfile } | null> {
  const client = getDataClient();
  if (!client?.models?.UserProfile) return null;

  try {
    const { data: profiles } = await client.models.UserProfile.list({ limit: 1 });
    if (profiles && profiles.length > 0) {
      const p = profiles[0];
      return {
        id: p.id,
        profile: {
          sex: p.sex as 'male' | 'female',
          weightKg: p.weightKg,
          heightCm: p.heightCm,
          age: p.age,
          activity: p.activity,
          goalDelta: p.goalDelta,
        },
      };
    }
    return null;
  } catch (err) {
    console.warn('Failed to fetch cloud profile', err);
    return null;
  }
}

/**
 * Save UserProfile to DynamoDB
 */
export async function saveCloudProfile(
  profile: UserProfile,
  existingId?: string
): Promise<string | null> {
  const client = getDataClient();
  if (!client?.models?.UserProfile) return null;

  try {
    if (existingId) {
      await client.models.UserProfile.update({
        id: existingId,
        sex: profile.sex,
        weightKg: profile.weightKg,
        heightCm: profile.heightCm,
        age: profile.age,
        activity: profile.activity,
        goalDelta: profile.goalDelta,
      });
      return existingId;
    } else {
      const { data: created } = await client.models.UserProfile.create({
        sex: profile.sex,
        weightKg: profile.weightKg,
        heightCm: profile.heightCm,
        age: profile.age,
        activity: profile.activity,
        goalDelta: profile.goalDelta,
      });
      return created?.id || null;
    }
  } catch (err) {
    console.warn('Failed to save cloud profile', err);
    return null;
  }
}

/**
 * Fetch all DailyLogs for the current user
 */
export async function fetchCloudDailyLogs(): Promise<Record<string, { id: string; record: DayRecord }>> {
  const client = getDataClient();
  if (!client?.models?.DailyLog) return {};

  try {
    const { data: logs } = await client.models.DailyLog.list({ limit: 500 });
    const result: Record<string, { id: string; record: DayRecord }> = {};

    for (const log of logs || []) {
      if (!log.date) continue;
      let items = [];
      try {
        items = log.itemsJson ? JSON.parse(log.itemsJson) : [];
      } catch {
        items = [];
      }

      result[log.date] = {
        id: log.id,
        record: {
          date: log.date,
          weightKg: log.weightKg ?? 70,
          items,
          targetKcal: log.targetKcal ?? undefined,
          targetP: log.targetP ?? undefined,
          targetC: log.targetC ?? undefined,
          targetF: log.targetF ?? undefined,
          notes: log.notes ?? undefined,
        },
      };
    }

    return result;
  } catch (err) {
    console.warn('Failed to fetch cloud daily logs', err);
    return {};
  }
}

/**
 * Save DailyLog for a specific day
 */
export async function saveCloudDailyLog(
  record: DayRecord,
  existingId?: string
): Promise<string | null> {
  const client = getDataClient();
  if (!client?.models?.DailyLog) return null;

  try {
    const payload = {
      date: record.date,
      weightKg: record.weightKg,
      itemsJson: JSON.stringify(record.items || []),
      targetKcal: record.targetKcal ?? 0,
      targetP: record.targetP ?? 0,
      targetC: record.targetC ?? 0,
      targetF: record.targetF ?? 0,
      notes: record.notes || '',
    };

    if (existingId) {
      await client.models.DailyLog.update({
        id: existingId,
        ...payload,
      });
      return existingId;
    } else {
      const { data: created } = await client.models.DailyLog.create(payload);
      return created?.id || null;
    }
  } catch (err) {
    console.warn('Failed to save cloud daily log', err);
    return null;
  }
}

/**
 * Fetch custom foods from DynamoDB
 */
export async function fetchCloudCustomFoods(): Promise<FoodItem[]> {
  const client = getDataClient();
  if (!client?.models?.CustomFood) return [];

  try {
    const { data: foods } = await client.models.CustomFood.list({ limit: 500 });
    return (foods || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      category: f.category || 'Custom',
      p: f.p,
      c: f.c,
      f: f.f,
      defaultGrams: f.defaultGrams || 100,
    }));
  } catch (err) {
    console.warn('Failed to fetch custom foods from cloud', err);
    return [];
  }
}

/**
 * Save custom food to DynamoDB
 */
export async function saveCloudCustomFood(food: FoodItem): Promise<string | null> {
  const client = getDataClient();
  if (!client?.models?.CustomFood) return null;

  try {
    const { data: created } = await client.models.CustomFood.create({
      name: food.name,
      category: food.category || 'Custom',
      p: food.p,
      c: food.c,
      f: food.f,
      defaultGrams: food.defaultGrams || 100,
    });
    return created?.id || null;
  } catch (err) {
    console.warn('Failed to save custom food to cloud', err);
    return null;
  }
}
