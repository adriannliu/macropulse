import type { FoodItem } from './mathEngine';
import { DEFAULT_FOODS } from './foodDb';
import { calcKcal } from './mathEngine';

export interface NutritionSearchResult {
  id: string;
  name: string;
  brand?: string;
  category: string;
  p: number; // per 100g
  c: number; // per 100g
  f: number; // per 100g
  kcal: number;
  defaultGrams: number;
  source: 'usda' | 'ai' | 'builtin';
}

const USDA_API_KEY = 'DEMO_KEY';

/**
 * Searches USDA FoodData Central for official nutrition facts per 100g
 */
export async function searchUSDANutrition(query: string): Promise<NutritionSearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(
    cleanQuery
  )}&api_key=${USDA_API_KEY}&pageSize=6`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`USDA API error (${res.status})`);
  }

  const data = await res.json();
  const foods = data.foods || [];

  const results: NutritionSearchResult[] = [];

  for (const item of foods) {
    const nutrients = item.foodNutrients || [];

    let p = 0;
    let c = 0;
    let f = 0;
    let kcal = 0;

    for (const n of nutrients) {
      const name = (n.nutrientName || '').toLowerCase();
      const val = Number(n.value) || 0;

      if (name === 'protein') {
        p = val;
      } else if (name.includes('carbohydrate') && !name.includes('other')) {
        c = val;
      } else if ((name.includes('total lipid') || name === 'fat') && !name.includes('fatty')) {
        f = val;
      } else if (name === 'energy' && (n.unitName === 'KCAL' || !n.unitName)) {
        if (!kcal || kcal < val) kcal = val;
      }
    }

    // Clean up description (title case, strip trailing codes)
    let displayName = item.description || cleanQuery;
    // Format "CHICKEN, BREAST, MEAT ONLY, COOKED" into clean title
    displayName = displayName
      .toLowerCase()
      .split(',')
      .map((part: string) => part.trim())
      .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(', ');

    const serving = item.servingSize ? Math.round(item.servingSize) : 100;
    const computedKcal = kcal > 0 ? Math.round(kcal) : Math.round(calcKcal(p, c, f));

    results.push({
      id: `usda_${item.fdcId || Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: displayName,
      brand: item.brandOwner || item.brandName || undefined,
      category: 'USDA Verified',
      p: Math.round(p * 10) / 10,
      c: Math.round(c * 10) / 10,
      f: Math.round(f * 10) / 10,
      kcal: computedKcal,
      defaultGrams: serving > 0 && serving <= 500 ? serving : 100,
      source: 'usda',
    });
  }

  return results;
}

/**
 * AI-assisted nutrition estimation using Google Gemini API
 */
export async function estimateWithGemini(
  query: string,
  apiKey: string
): Promise<NutritionSearchResult> {
  const prompt = `You are a nutrition database. Provide estimated macronutrients per 100 grams for the food: "${query}".
Respond ONLY with a valid JSON object in this exact schema:
{
  "name": "Standard food name",
  "category": "Protein | Carbs | Fats | Home-Cooked | Produce | Dairy & Eggs",
  "p": 25.0,
  "c": 0.0,
  "f": 3.5,
  "defaultGrams": 150
}
Note:
- "p", "c", "f" MUST be grams per 100g of the food.
- "defaultGrams" is a typical realistic single-portion serving in grams (e.g., 100-250g).
- Respond with pure JSON only, no markdown, no explanation.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey.trim()}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${err}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response from Gemini API');

  const parsed = JSON.parse(text);
  const p = Math.max(0, Number(parsed.p) || 0);
  const c = Math.max(0, Number(parsed.c) || 0);
  const f = Math.max(0, Number(parsed.f) || 0);
  const defaultGrams = Math.max(10, Number(parsed.defaultGrams) || 100);

  return {
    id: `ai_${Date.now()}`,
    name: parsed.name || query,
    category: parsed.category || 'AI Estimated',
    p: Math.round(p * 10) / 10,
    c: Math.round(c * 10) / 10,
    f: Math.round(f * 10) / 10,
    kcal: Math.round(calcKcal(p, c, f)),
    defaultGrams,
    source: 'ai',
  };
}

/**
 * Instant offline fuzzy matching against built-in food database
 */
export function searchOfflineDatabase(
  query: string,
  allFoods: FoodItem[] = DEFAULT_FOODS
): NutritionSearchResult[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const words = q.split(/\s+/).filter(Boolean);

  const matched = allFoods.filter((f) => {
    const name = f.name.toLowerCase();
    const cat = f.category.toLowerCase();
    return words.every((w) => name.includes(w) || cat.includes(w));
  });

  return matched.slice(0, 5).map((f) => ({
    id: `builtin_${f.id}`,
    name: f.name,
    category: f.category,
    p: f.p,
    c: f.c,
    f: f.f,
    kcal: Math.round(calcKcal(f.p, f.c, f.f)),
    defaultGrams: f.defaultGrams,
    source: 'builtin',
  }));
}

/**
 * Universal auto-lookup: checks AI if key present, else USDA, falling back to offline.
 */
export async function smartDiscoverMacros(
  query: string,
  geminiKey?: string,
  localFoods: FoodItem[] = DEFAULT_FOODS
): Promise<NutritionSearchResult[]> {
  const clean = query.trim();
  if (!clean) return [];

  // If Gemini API key is provided, prefer AI estimation for complex dishes
  if (geminiKey && geminiKey.trim().length > 10) {
    try {
      const aiResult = await estimateWithGemini(clean, geminiKey);
      return [aiResult];
    } catch (e) {
      console.warn('Gemini estimation failed, falling back to USDA', e);
    }
  }

  // Try USDA FoodData Central
  try {
    const usdaResults = await searchUSDANutrition(clean);
    if (usdaResults.length > 0) {
      return usdaResults;
    }
  } catch (e) {
    console.warn('USDA API search failed, falling back to offline database', e);
  }

  // Fallback to offline search
  return searchOfflineDatabase(clean, localFoods);
}
