import type { FoodItem, LoggedFood } from './mathEngine';
import { DEFAULT_FOODS } from './foodDb';
import { searchUSDANutrition } from './nutritionApi';

export interface ParsedItem {
  id: string;
  name: string;
  category: string;
  grams: number;
  p: number; // per 100g
  c: number; // per 100g
  f: number; // per 100g
  explanation?: string;
}

export interface ParsedMealResult {
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snacks';
  items: ParsedItem[];
  rawText: string;
}

/**
 * Natural Language Meal Parser:
 * 1. Tries serverless backend endpoint (/api/parse-meal) using global GEMINI_API_KEY
 * 2. If no server key or offline, tries client-provided Gemini key
 * 3. Fallback to offline / USDA heuristic
 */
export async function parseMealWithAI(
  text: string,
  userApiKey?: string,
  defaultMeal: 'breakfast' | 'lunch' | 'dinner' | 'snacks' = 'lunch'
): Promise<ParsedMealResult> {
  const cleanPrompt = text.trim();
  if (!cleanPrompt) {
    throw new Error('Please describe what you ate first.');
  }

  // Check user key or global project key configured in environment
  const effectiveKey = (
    userApiKey ||
    (import.meta as any).env?.VITE_GEMINI_API_KEY ||
    ''
  ).trim();

  // 1. If we have a valid key (either global or user), call Gemini directly
  if (effectiveKey && effectiveKey.length > 10) {
    return directClientGeminiParse(cleanPrompt, effectiveKey, defaultMeal);
  }

  // 2. Try serverless function (if deployed on platform supporting /api routes)
  try {
    const res = await fetch('/api/parse-meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleanPrompt,
        defaultMeal,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        return {
          meal: data.meal || defaultMeal,
          items: data.items,
          rawText: cleanPrompt,
        };
      }
    }
  } catch (err) {
    console.warn('Serverless /api/parse-meal unavailable, checking client fallback...', err);
  }

  throw new Error('NO_KEY_CONFIGURED');
}

let cachedModels: string[] | null = null;

// Fast, non-preview text models in order of preference. Pro models are excluded:
// they always think before answering and take 10s+ for this workload.
const PREFERRED_MODELS = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-flash-lite-latest',
];

// Specialised variants that list generateContent but can't return plain JSON text
const EXCLUDED_MODEL_PATTERN = /tts|image|audio|live|embedding|robotics|computer-use|thinking|exp|preview|learnlm|gemma/;

const MAX_MODEL_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 20000;

/**
 * Dynamically queries Google's API for models this key can use, returning at most
 * MAX_MODEL_ATTEMPTS fast Flash models (known-good IDs first) so failures can't cascade.
 */
export async function getAvailableGeminiModels(apiKey: string): Promise<string[]> {
  if (cachedModels && cachedModels.length > 0) return cachedModels;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = await res.json();
      const available: string[] = (data.models || [])
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => m.name.replace(/^models\//, ''));

      const preferred = PREFERRED_MODELS.filter((m) => available.includes(m));
      const otherFlash = available
        .filter((m) => m.includes('flash') && !EXCLUDED_MODEL_PATTERN.test(m) && !preferred.includes(m))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

      const models = [...preferred, ...otherFlash].slice(0, MAX_MODEL_ATTEMPTS);
      if (models.length > 0) {
        cachedModels = models;
        return models;
      }
    }
  } catch (e) {
    console.warn('Failed to dynamically list models', e);
  }

  // Safe fallback defaults
  return PREFERRED_MODELS.slice(0, MAX_MODEL_ATTEMPTS);
}

type GeminiCallResult =
  | { ok: true; text: string }
  | { ok: false; status: number; error: Error };

async function callGeminiModel(
  apiKey: string,
  model: string,
  prompt: string,
  generationConfig: Record<string, unknown>
): Promise<GeminiCallResult> {
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );
  } catch (e: any) {
    const error = e?.name === 'TimeoutError' ? new Error(`Gemini (${model}) timed out`) : e;
    return { ok: false, status: 0, error };
  }

  if (!res.ok) {
    const errText = await res.text();
    return {
      ok: false,
      status: res.status,
      error: new Error(`Gemini (${model}) ${res.status}: ${errText.slice(0, 150)}`),
    };
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return text
    ? { ok: true, text }
    : { ok: false, status: res.status, error: new Error(`Gemini (${model}) returned an empty response`) };
}

/**
 * Sends a prompt to Gemini expecting a JSON response, trying a few fast models in order.
 */
export async function generateGeminiJson(
  apiKey: string,
  prompt: string,
  temperature = 0.2
): Promise<string> {
  const models = await getAvailableGeminiModels(apiKey);
  let lastError: Error | null = null;

  for (const model of models) {
    const baseConfig = { responseMimeType: 'application/json', temperature };
    // Minimise thinking: these are simple structured lookups and thinking adds 5-30s.
    // 2.5 models take a token budget; 3.x models take a level.
    const thinkingConfig = model.startsWith('gemini-2.5')
      ? { thinkingBudget: 0 }
      : { thinkingLevel: 'low' };

    let result = await callGeminiModel(apiKey, model, prompt, { ...baseConfig, thinkingConfig });
    // Older models reject thinkingConfig entirely; retry once without it
    if (!result.ok && result.status === 400 && /thinking/i.test(result.error.message)) {
      result = await callGeminiModel(apiKey, model, prompt, baseConfig);
    }

    if (result.ok) return result.text;
    lastError = result.error;
    // Invalid / unauthorised key won't be fixed by another model
    if (result.status === 401 || result.status === 403) {
      throw lastError;
    }
  }

  throw lastError || new Error('Empty response from AI. Please try again.');
}

/**
 * Direct client-side Gemini fallback
 */
async function directClientGeminiParse(
  text: string,
  apiKey: string,
  defaultMeal: 'breakfast' | 'lunch' | 'dinner' | 'snacks'
): Promise<ParsedMealResult> {
  const prompt = `You are a world-class clinical sports nutritionist, culinary expert, and calorie tracking assistant.
A user describes what they ate in natural language:
"${text}"

Your task:
1. Deconstruct the meal into individual distinct food ingredients/items.
2. Estimate the realistic total consumed weight in GRAMS for each item based on common serving sizes, household measurements, or explicit counts (e.g. "2 campari tomatoes" = ~100g total, ~50g each; "2 trader joes hashbrowns" = 2 patties, ~120g total, ~60g each; "a scoop of whey" = 30-35g; "a palm of chicken" = 140g).
3. If specific grocery brands (e.g. Trader Joe's, Costco/Kirkland, Fairlife, Dave's Killer Bread) or restaurants (e.g. Chipotle, Sweetgreen, In-N-Out) are mentioned, use their exact real-world nutritional profiles.
4. Provide the accurate macronutrient density PER 100 GRAMS (Protein "p", Carbohydrates "c", Fat "f") for each item.
5. Detect the meal category: "breakfast" | "lunch" | "dinner" | "snacks" (if the text specifies "for breakfast" or time of day, otherwise default to "${defaultMeal}").

Standard Portions & Brand References:
- 1 Campari tomato = ~50g (100g: 0.9g P, 3.9g C, 0.2g F, 18 kcal)
- Trader Joe's Hash Brown Patty = ~60g each (100g: 1.7g P, 25.0g C, 13.3g F, 217 kcal)
- 1 large egg = ~50g (100g: 12.6g P, 0.7g C, 9.5g F)
- 1 slice sourdough/bread = ~50-60g
- 1/2 avocado = ~75-80g edible portion (100g: 2.0g P, 8.5g C, 14.7g F)
- 1 cup cooked jasmine rice = ~180-200g (100g: 2.7g P, 28.2g C, 0.3g F)
- 1 scoop whey isolate = ~30-35g (100g: 83g P, 3g C, 1.5g F)
- 1 tbsp olive oil/butter = ~14g (100g: 0g P, 0g C, 100g F)
- Cooked chicken breast = 100g: 31.0g P, 0.0g C, 3.6g F

Respond ONLY with a valid JSON object matching this schema, no markdown codeblocks, no commentary:
{
  "meal": "breakfast" | "lunch" | "dinner" | "snacks",
  "items": [
    {
      "name": "Food item name",
      "category": "Protein | Carbs | Fats | Home-Cooked | Produce | Dairy & Eggs",
      "grams": 150,
      "p": 31.0,
      "c": 0.0,
      "f": 3.6,
      "explanation": "e.g. 2 patties (60g each)"
    }
  ]
}`;

  const rawJson = await generateGeminiJson(apiKey, prompt);

  const parsed = JSON.parse(rawJson);
  const items: ParsedItem[] = (parsed.items || []).map((it: any, idx: number) => {
    const p = Math.max(0, Math.round((Number(it.p) || 0) * 10) / 10);
    const c = Math.max(0, Math.round((Number(it.c) || 0) * 10) / 10);
    const f = Math.max(0, Math.round((Number(it.f) || 0) * 10) / 10);
    const grams = Math.max(5, Math.round(Number(it.grams) || 100));

    return {
      id: `ai_${Date.now()}_${idx}`,
      name: it.name || `Item ${idx + 1}`,
      category: it.category || 'AI Parsed',
      grams,
      p,
      c,
      f,
      explanation: it.explanation || `${grams}g`,
    };
  });

  return {
    meal: parsed.meal || defaultMeal,
    items,
    rawText: text,
  };
}

/**
 * Offline Heuristic Parser: extracts items and units using regex and built-in foods / USDA search
 */
export async function parseMealOffline(
  text: string,
  defaultMeal: 'breakfast' | 'lunch' | 'dinner' | 'snacks' = 'lunch',
  foodLibrary: FoodItem[] = DEFAULT_FOODS
): Promise<ParsedMealResult> {
  const lower = text.toLowerCase();

  // Detect meal
  let meal: 'breakfast' | 'lunch' | 'dinner' | 'snacks' = defaultMeal;
  if (lower.includes('breakfast')) meal = 'breakfast';
  else if (lower.includes('lunch')) meal = 'lunch';
  else if (lower.includes('dinner')) meal = 'dinner';
  else if (lower.includes('snack')) meal = 'snacks';

  // Split by common delimiters
  const segments = text
    .replace(/\b(for breakfast|for lunch|for dinner|for snack|for a snack|today|i had|i ate|ate|had)\b/gi, '')
    .split(/,|\band\b|\bwith\b|\bplus\b|\+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);

  const items: ParsedItem[] = [];

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    const segLower = seg.toLowerCase();

    // Estimate grams from numbers/units
    let grams = 100;
    const qtyMatch = segLower.match(
      /(\d+(?:\.\d+)?)\s*(g|grams|gram|kg|oz|ounce|ounces|lbs|scoop|scoops|cup|cups|tbsp|tablespoon|slices?|eggs?|pieces?|pcs)/i
    );

    if (qtyMatch) {
      const num = parseFloat(qtyMatch[1]);
      const unit = qtyMatch[2].toLowerCase();
      if (unit.startsWith('g')) grams = Math.round(num);
      else if (unit === 'kg') grams = Math.round(num * 1000);
      else if (unit.startsWith('oz') || unit.startsWith('ounce')) grams = Math.round(num * 28.35);
      else if (unit.startsWith('lb')) grams = Math.round(num * 453.6);
      else if (unit.startsWith('cup')) grams = Math.round(num * 180);
      else if (unit.startsWith('scoop')) grams = Math.round(num * 30);
      else if (unit.startsWith('tbsp') || unit.startsWith('tablespoon')) grams = Math.round(num * 14);
      else if (unit.startsWith('slice')) grams = Math.round(num * 50);
      else if (unit.startsWith('egg')) grams = Math.round(num * 50);
      else if (unit.startsWith('piece') || unit.startsWith('pc')) grams = Math.round(num * 40);
    } else {
      if (segLower.includes('half')) grams = 75;
      else if (segLower.includes('two') || segLower.includes('2')) grams = 120;
      else if (segLower.includes('three') || segLower.includes('3')) grams = 180;
      else if (segLower.includes('four') || segLower.includes('4')) grams = 240;
      else if (segLower.includes('bowl')) grams = 250;
      else if (segLower.includes('handful')) grams = 35;
    }

    const cleanFoodName = seg
      .replace(
        /(\d+(?:\.\d+)?)\s*(g|grams|gram|kg|oz|ounce|ounces|lbs|scoop|scoops|cup|cups|tbsp|tablespoon|slices?|eggs?|pieces?|pcs)/gi,
        ''
      )
      .replace(/\b(a|an|the|of|some|fresh|cooked|steamed|grilled|crispy|large|medium|small|boiled)\b/gi, '')
      .trim();

    const matchedFood = foodLibrary.find((f) => {
      const fn = f.name.toLowerCase();
      return cleanFoodName.split(/\s+/).some((w) => w.length > 2 && fn.includes(w));
    });

    if (matchedFood) {
      items.push({
        id: `offline_${Date.now()}_${idx}`,
        name: matchedFood.name,
        category: matchedFood.category,
        grams,
        p: matchedFood.p,
        c: matchedFood.c,
        f: matchedFood.f,
        explanation: `Matched from library (${grams}g)`,
      });
    } else {
      try {
        const usda = await searchUSDANutrition(cleanFoodName || seg);
        if (usda.length > 0) {
          const top = usda[0];
          items.push({
            id: `usda_${Date.now()}_${idx}`,
            name: top.name,
            category: top.category,
            grams,
            p: top.p,
            c: top.c,
            f: top.f,
            explanation: `USDA: ${top.name} (${grams}g)`,
          });
          continue;
        }
      } catch {
        // Fallback
      }

      items.push({
        id: `offline_fallback_${Date.now()}_${idx}`,
        name: cleanFoodName.charAt(0).toUpperCase() + cleanFoodName.slice(1) || seg,
        category: 'Custom',
        grams,
        p: 10,
        c: 15,
        f: 5,
        explanation: 'Estimated portion',
      });
    }
  }

  return {
    meal,
    items,
    rawText: text,
  };
}

export function convertParsedToLoggedFoods(
  parsed: ParsedItem[],
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snacks'
): { loggedFoods: LoggedFood[]; foodItems: FoodItem[] } {
  const loggedFoods: LoggedFood[] = [];
  const foodItems: FoodItem[] = [];

  for (const item of parsed) {
    const food: FoodItem = {
      id: `food_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: item.name,
      category: item.category,
      p: item.p,
      c: item.c,
      f: item.f,
      defaultGrams: item.grams,
    };
    foodItems.push(food);
    loggedFoods.push({
      uid: crypto.randomUUID(),
      food,
      grams: item.grams,
      meal,
    });
  }

  return { loggedFoods, foodItems };
}
