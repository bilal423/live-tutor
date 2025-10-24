require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;


const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/', (req, res) => res.json({ ok: true }));

// Helper: Format tutor response (extract steps, equations, final answer)
const formatTutorResponse = (responseArray) => {
  let finalAnswer = null;

  const steps = responseArray
    .filter((item) => {
      if (!item || typeof item.explaination !== 'string') {
        console.warn(' Skipping invalid step:', item);
        return false;
      }

      if (/final answer/i.test(item.explaination)) {
        const match = item.explaination.match(/(-?\d+(\.\d+)?)/);
        if (match) finalAnswer = Number(match[1]);
        return false;
      }

      return true;
    })
    .map((item) => {
      const text = typeof item.explaination === 'string' ? item.explaination.trim() : '';
      const parts = text.split(':');
      const title = parts[0]?.trim() || '';
      const equation = parts[1]?.trim()?.replace(/\.$/, '') || null;

      return {
        step: item.step ?? null,
        title,
        explanation: text,
        equation,
      };
    });

  return { steps, finalAnswer };
};

// Analyze endpoint
app.post('/analyze', async (req, res) => {
  const { text, imageUrl } = req.body;

  if (!text || !imageUrl) {
    return res
      .status(400)
      .json({ success: false, message: 'Both text and imageUrl are required.' });
  }

  const payload = {
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content:
          'You are an expert tutor analyzing problems from images. Return a valid JSON array: [{ step: 1, explaination: "..." }, ...]. Include a final step with "The final answer is X". Do not use markdown or formatting symbols.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `${text}\nPlease explain step-by-step.` },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
  };

  try {
    const resp = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 120_000,
    });

    const rawText = resp.data?.choices?.[0]?.message?.content?.trim();

    if (!rawText) {
      return res.status(500).json({
        success: false,
        message: 'Unexpected API response structure (no content).',
        raw: resp.data,
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const jsonMatch = rawText.match(/\[.*\]/s);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    }

    if (!Array.isArray(parsed)) {
      return res.status(200).json({
        success: false,
        message: 'Model output was not valid JSON array.',
        rawText,
        steps: [],
        finalAnswer: null,
      });
    }

    const { steps, finalAnswer } = formatTutorResponse(parsed);

    return res.status(200).json({
      success: true,
      steps,
      finalAnswer,
      rawText,
    });
  } catch (err) {
    console.error('❌ OpenAI API error:', err.message);
    return res.status(err.response?.status || 500).json({
      success: false,
      message: err.response?.data?.error?.message || err.message,
    });
  }
});

// 🚀 Start server
const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Server listening at http://${HOST}:${PORT}`);
});

server.on('error', (e) => {
  console.error(' Server error:', e.code, e.message);
  if (e.code === 'EADDRINUSE') {
    console.error(` Port ${PORT} already in use. Try another PORT or stop the running process.`);
  }
});
