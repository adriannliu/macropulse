export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { text, defaultMeal = 'lunch', userKey } = body;

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Text prompt is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const apiKey = (process.env.GEMINI_API_KEY || userKey || '').trim();
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: 'NO_GLOBAL_KEY',
          message: 'No GEMINI_API_KEY configured on server or in request.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
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

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(geminiUrl, {
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

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      return new Response(
        JSON.stringify({ error: `Gemini API error (${geminiRes.status}): ${err}` }),
        { status: geminiRes.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = await geminiRes.json();
    const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawJson) {
      return new Response(JSON.stringify({ error: 'Empty response from AI' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const parsed = JSON.parse(rawJson);
    const items = (parsed.items || []).map((it: any, idx: number) => {
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

    return new Response(
      JSON.stringify({
        meal: parsed.meal || defaultMeal,
        items,
        source: 'server_gemini',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
