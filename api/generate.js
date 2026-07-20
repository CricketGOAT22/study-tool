function looksLikeUrl(str) {
  return /^https?:\/\/\S+$/i.test(str.trim());
}

async function extractTextFromUrl(url) {
  const pageResponse = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StudyToolBot/1.0)' }
  });
  const html = await pageResponse.text();
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const text = noScripts.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, 6000);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let { notes } = req.body || {};
  if (!notes || notes.trim().length < 3) {
    return res.status(400).json({ error: 'Not enough notes provided' });
  }

  if (looksLikeUrl(notes)) {
    try {
      notes = await extractTextFromUrl(notes.trim());
    } catch (err) {
      console.error('URL fetch error:', err);
      return res.status(400).json({ error: 'Could not read that URL. Try pasting the text directly instead.' });
    }
  }

  if (!notes || notes.trim().length < 30) {
    return res.status(400).json({ error: 'Not enough usable text found' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured with an API key yet' });
  }

  const prompt = `You are helping a student study. Given their raw notes below, produce a compact JSON object with EXACTLY this shape and nothing else (no markdown fences, no preamble, no extra commentary):
{"lowConfidence":false,"summary":"2-3 sentence plain-English summary of the material","keyConcepts":[{"title":"short concept name","detail":"1 sentence explanation"}],"flashcards":[{"front":"question or term","back":"short answer"}],"quiz":[{"question":"question text","choices":["A","B","C","D"],"answerIndex":0}]}

Rules: keyConcepts should have 4-6 items. flashcards should have 6-8 items. quiz should have 6-8 items, each with exactly 4 choices and answerIndex as the 0-based index of the correct choice. Keep every string short and clear. Base everything strictly on the notes provided, don't invent outside facts.

IMPORTANT: If the notes below are too thin, vague, garbled, mostly boilerplate (like navigation menus, cookie notices, ads), or otherwise not enough to confidently build accurate study material from, set "lowConfidence" to true and do your best with what's there rather than inventing details to fill gaps.

NOTES:
"""${notes}"""`;

  try {
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 2200,
        response_format: { type: 'json_object' }
      })
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      console.error('Groq error:', errText);
      return res.status(502).json({ error: 'AI service error' });
    }

    const data = await groqResponse.json();
    const rawText = data?.choices?.[0]?.message?.content || '';
    let cleaned = rawText.replace(/```json|```/g, '').trim();

    // Fallback: if there's stray text before/after the JSON object, extract just the {...} part
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    const parsed = JSON.parse(cleaned);

    // Deterministic backstop: don't trust the AI's own judgment alone —
    // if the source material was genuinely thin, always flag it.
    if (notes.trim().length < 150) {
      parsed.lowConfidence = true;
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to generate study guide' });
  }
}
