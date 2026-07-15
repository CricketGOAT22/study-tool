export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { notes } = req.body || {};
  if (!notes || notes.trim().length < 30) {
    return res.status(400).json({ error: 'Not enough notes provided' });
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
        max_tokens: 1400
      })
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      console.error('Groq error:', errText);
      return res.status(502).json({ error: 'AI service error' });
    }

    const data = await groqResponse.json();
    const rawText = data?.choices?.[0]?.message?.content || '';
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    return res.status(200).json(parsed);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to generate new quiz' });
  }
}
