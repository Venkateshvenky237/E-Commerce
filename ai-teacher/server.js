import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Resolve dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static client
app.use(express.static(path.join(__dirname, 'public')));

// Health
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Issue an ephemeral OpenAI Realtime session token via server
// NOTE: This uses the OpenAI REST endpoint to mint a short-lived client token
app.post('/session', async (req, res) => {
  try {
    const { persona, memory } = req.body || {};
    const instructions = (persona || memory)
      ? `${persona ? `Persona: ${persona}\n` : ''}${memory ? `Memory: ${memory}\n` : ''}`
      : undefined;

    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17',
        voice: process.env.OPENAI_TTS_VOICE || 'verse',
        // Provide initial system instructions for teaching persona
        // Different SDKs call this different things; for Realtime it's `instructions`
        instructions: instructions || `You are a private tutor. Teach one micro-concept at a time, use simple words, pause to ask a short check question, correct gently, and adapt difficulty. Keep responses concise and end with a question.`
      })
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).send(text);
    }

    const json = await response.json();
    res.json(json);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed_to_create_session' });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`AI Teacher server listening on http://localhost:${port}`);
});
