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
 * Gemini 1.5 Flash Natural Language Meal Parser
 */
export async function parseMealWithAI(
  text: string,
  apiKey: string,
  defaultMeal: 'breakfast' | 'lunch' | 'dinner' | 'snacks' = 'lunch'
): Promise<ParsedMealResult> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('Please enter your Google Gemini API key in Settings.');
  }

  const prompt = `You are a world-class clinical sports nutritionist and calorie tracking assistant.
A user describes what they ate in natural language:
"${text}"

Your task:
1. Deconstruct the meal into individual distinct food ingredients/items.
2. Estimate the realistic total consumed weight in GRAMS for each item based on common serving sizes, household measurements (e.g. "a scoop", "2 eggs", "half an avocado", "a palm-sized steak", "1 bowl"), or explicit weights provided.
3. Provide the accurate macronutrient density PER 100 GRAMS (Protein "p", Carbohydrates "c", Fat "f") for each item.
4. Detect the meal category: "breakfast" | "lunch" | "dinner" | "snacks" (if the text specifies "for breakfast" or time of day, otherwise default to "${defaultMeal}").

Standard Portions Reference:
- 1 large egg = ~50g (whole: 12.6g P, 0.7g C, 9.5g F per 100g)
- 1 slice bread = ~50-60g
- 1/2 avocado = ~75-80g (edible portion)
- 1 cup cooked rice = ~180-200g
- 1 scoop protein powder = ~30-35g
- 1 tbsp olive oil/butter = ~14g
- 1 palm of meat/poultry/fish = ~120-160g cooked
- 1 bowl of soup/noodles = ~300-400g

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
      "explanation": "e.g. 1 palm-sized cooked breast"
    }
  ]
}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${cleanKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 400 || res.status === 403) {
      throw new Error('Invalid Gemini API Key or permission denied.');
    }
    throw new Error(`Gemini API error (${res.status}): ${errorText.slice(0, 100)}`);
  }

  const data = await res.json();
  const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawJson) {
    throw new Error('Empty response from AI. Please try again.');
  }

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

  // Split by common delimiters: "and", ",", "with", "plus", "+"
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
    let qtyMatch = segLower.match(/(\d+(?:\.\d+)?)\s*(g|grams|gram|kg|oz|ounce|ounces|lbs|scoop|scoops|cup|cups|tbsp|tablespoon|slices?|eggs?|pieces?|pcs)/i);

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
      // Natural language multipliers
      if (segLower.includes('half')) grams = 75;
      else if (segLower.includes('two') || segLower.includes('2')) grams = 120;
      else if (segLower.includes('three') || segLower.includes('3')) grams = 180;
      else if (segLower.includes('four') || segLower.includes('4')) grams = 240;
      else if (segLower.includes('bowl')) grams = 250;
      else if (segLower.includes('handful')) grams = 35;
    }

    // Try matching in foodLibrary
    const cleanFoodName = seg
      .replace(/(\d+(?:\.\d+)?)\s*(g|grams|gram|kg|oz|ounce|ounces|lbs|scoop|scoops|cup|cups|tbsp|tablespoon|slices?|eggs?|pieces?|pcs)/gi, '')
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
      // Try USDA lookup for segment
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
        // Ignore USDA error in offline fallback
      }

      // Default fallback
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

/**
 * Converts parsed items to standard LoggedFood items
 */
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
