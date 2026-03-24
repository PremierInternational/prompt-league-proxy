/**
 * Prompt League — Local Proxy Server
 *
 * Sits between the browser POC and the Anthropic API so the API key
 * never touches the browser. Run once, leave it running while piloting.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node server.js
 *
 * Then open prompt_competition_poc.html via http://localhost:3001/app
 * (the proxy also serves the HTML file itself)
 */

const express = require('express');
const cors    = require('cors');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3001;
const KEY  = process.env.ANTHROPIC_API_KEY;

// ── Startup check ────────────────────────────────────────────────────────────
if (!KEY) {
  console.error('\n  ERROR: ANTHROPIC_API_KEY environment variable is not set.\n');
  console.error('  Run with:  ANTHROPIC_API_KEY=sk-ant-... node server.js\n');
  process.exit(1);
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' })); // 10mb for base64 image payloads

// ── Serve the POC HTML ───────────────────────────────────────────────────────
const HTML_PATH = path.join(__dirname, 'prompt_competition_poc.html');
app.get('/', (req, res) => {
  if (fs.existsSync(HTML_PATH)) {
    res.sendFile(HTML_PATH);
  } else {
    res.status(404).send(
      '<h2>prompt_competition_poc.html not found</h2>' +
      '<p>Place <code>prompt_competition_poc.html</code> in the same folder as <code>server.js</code>, then refresh.</p>'
    );
  }
});
app.get('/app', (req, res) => res.redirect('/'));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', port: PORT }));

// ── Anthropic proxy ──────────────────────────────────────────────────────────
app.post('/api/score', async (req, res) => {
  const { model, max_tokens, system, messages } = req.body;

  // Basic validation
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const payload = JSON.stringify({
    model:      model      || 'claude-sonnet-4-20250514',
    max_tokens: max_tokens || 1000,
    system,
    messages,
  });

  const options = {
    hostname: 'api.anthropic.com',
    path:     '/v1/messages',
    method:   'POST',
    headers: {
      'Content-Type':      'application/json',
      'Content-Length':    Buffer.byteLength(payload),
      'x-api-key':         KEY,
      'anthropic-version': '2023-06-01',
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => { data += chunk; });
    apiRes.on('end', () => {
      res.status(apiRes.statusCode).set('Content-Type', 'application/json').send(data);
    });
  });

  apiReq.on('error', (err) => {
    console.error('[proxy error]', err.message);
    res.status(502).json({ error: 'Upstream API request failed', detail: err.message });
  });

  apiReq.write(payload);
  apiReq.end();
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n  ╔══════════════════════════════════════════╗');
  console.log('  ║   Prompt League proxy  — running         ║');
  console.log('  ╚══════════════════════════════════════════╝\n');
  console.log(`  App:    http://localhost:${PORT}`);
  console.log(`  Proxy:  http://localhost:${PORT}/api/score`);
  console.log(`  Health: http://localhost:${PORT}/health\n`);
  console.log('  Leave this terminal open while running the pilot.\n');
});
