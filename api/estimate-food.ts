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
    const { query, userKey } = body;

    if (!query || typeof query !== 'string') {
      return new Response(JSON.stringify({ error: 'Query is required' }), {
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

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
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
    const p = Math.max(0, Math.round((Number(parsed.p) || 0) * 10) / 10);
    const c = Math.max(0, Math.round((Number(parsed.c) || 0) * 10) / 10);
    const f = Math.max(0, Math.round((Number(parsed.f) || 0) * 10) / 10);
    const defaultGrams = Math.max(10, Math.round(Number(parsed.defaultGrams) || 100));

    return new Response(
      JSON.stringify({
        id: `ai_${Date.now()}`,
        name: parsed.name || query,
        category: parsed.category || 'AI Estimated',
        p,
        c,
        f,
        defaultGrams,
        source: 'server_ai',
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
