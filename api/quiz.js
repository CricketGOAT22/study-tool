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
      return res.status(400).json({ error: 'Could not read that URL' });
    }
  }

  if (!notes || notes.trim().length < 30) {
    return res.status(400).json({ error: 'Not enough usable text found' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured with an API key yet' });
  }

  const prompt = `Based on the student notes below, write a FRESH set of 6-8 multiple choice quiz questions, different phrasing and angles than a typical first pass. Respond with ONLY this JSON shape, nothing else:
{"quiz":[{"question":"question text","choices":["A","B","C","D"],"answerIndex":0}]}

Each question needs exactly 4 choices. Keep everything short and clear. Base it strictly on the notes, don't invent outside facts.

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
        temperature: 0.7,
        max_tokens: 1400,
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

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    const parsed = JSON.parse(cleaned);

    return res.status(200).json(parsed);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to generate new quiz' });
  }
}
