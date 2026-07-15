export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { notes } = req.body || {};
  if (!notes || notes.trim().length < 30) {
    return res.status(400).json({ error: 'Not enough notes provided' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured with an API key yet' });
  }

  const prompt = `You are helping a student study. Given their raw notes below, produce a compact JSON object with EXACTLY this shape and nothing else (no markdown fences, no preamble, no extra commentary):
{"summary":"2-3 sentence plain-English summary of the material","keyConcepts":[{"title":"short concept name","detail":"1 sentence explanation"}],"flashcards":[{"front":"question or term","back":"short answer"}],"quiz":[{"question":"question text","choices":["A","B","C","D"],"answerIndex":0}]}

Rules: keyConcepts should have 4-6 items. flashcards should have 6-8 items. quiz should have 3-4 items, each with exactly 4 choices and answerIndex as the 0-based index of the correct choice. Keep every string short and clear. Base everything strictly on the notes provided, don't invent outside facts.

NOTES:
"""${notes}"""`;

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1500 }
        })
      }
    );

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error('Gemini error:', errText);
      return res.status(502).json({ error: 'AI service error' });
    }

    const data = await geminiResponse.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    return res.status(200).json(parsed);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to generate study guide' });
  }
}
