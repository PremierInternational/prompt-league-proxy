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
const Database = require('better-sqlite3');

const app  = express();
const PORT = process.env.PORT || 3001;
const KEY  = process.env.ANTHROPIC_API_KEY;

// ── Startup check ────────────────────────────────────────────────────────────
if (!KEY) {
  console.error('\n  ERROR: ANTHROPIC_API_KEY environment variable is not set.\n');
  console.error('  Run with:  ANTHROPIC_API_KEY=sk-ant-... node server.js\n');
  process.exit(1);
}

// ── Database setup ───────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'prompt_league.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT NOT NULL,
    dept TEXT NOT NULL DEFAULT '—',
    week INTEGER NOT NULL DEFAULT 1,
    season INTEGER NOT NULL DEFAULT 1,
    prompt TEXT NOT NULL,
    response_text TEXT,
    clarity INTEGER NOT NULL DEFAULT 0,
    context INTEGER NOT NULL DEFAULT 0,
    specificity INTEGER NOT NULL DEFAULT 0,
    technique INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    grade TEXT NOT NULL DEFAULT 'D',
    headline TEXT,
    strengths TEXT,
    improvements TEXT,
    improved_prompt TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ── Config: names and departments for dropdowns ──────────────────────────────
const CONFIG = {
  names: [
    "Alex B.", "Amanda C.", "Andrew H.", "Angela M.", "Ben T.",
    "Beth R.", "Brian K.", "Carlos D.", "Catherine L.", "Chris W.",
    "Dan F.", "Diana P.", "Emily S.", "Eric J.", "Grace N.",
    "Hannah Z.", "Jack M.", "James O.", "Jennifer A.", "Jessica K.",
    "John D.", "Karen W.", "Kate R.", "Kevin L.", "Laura B.",
    "Lisa H.", "Mark T.", "Matt S.", "Megan C.", "Michael P.",
    "Michelle G.", "Nick V.", "Olivia F.", "Patrick N.", "Rachel E.",
    "Rebecca D.", "Ryan M.", "Sam W.", "Sarah K.", "Steve J.",
    "Tom A.", "Tyler B.", "Victoria L."
  ],
  departments: [
    "Accounting", "Business Development", "Customer Success",
    "Data & Analytics", "Design", "Engineering", "Executive",
    "Finance", "HR & People Ops", "IT", "Legal", "Marketing",
    "Operations", "Product", "Project Management", "QA",
    "Sales", "Security", "Support"
  ]
};

// ── Prepared statements ──────────────────────────────────────────────────────
const insertSubmission = db.prepare(`
  INSERT INTO submissions (user, dept, week, season, prompt, response_text,
    clarity, context, specificity, technique, total, grade,
    headline, strengths, improvements, improved_prompt)
  VALUES (@user, @dept, @week, @season, @prompt, @response_text,
    @clarity, @context, @specificity, @technique, @total, @grade,
    @headline, @strengths, @improvements, @improved_prompt)
`);

// Best score per user — used by all leaderboard queries
const leaderboardQuery = (whereClause) => db.prepare(`
  SELECT user, dept, MAX(total) as total, grade
  FROM submissions
  WHERE total = (
    SELECT MAX(s2.total) FROM submissions s2
    WHERE s2.user = submissions.user ${whereClause ? 'AND ' + whereClause : ''}
  ) ${whereClause ? 'AND ' + whereClause : ''}
  GROUP BY user
  ORDER BY total DESC
  LIMIT 50
`);

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

// ── Config endpoint (names + departments for dropdowns) ──────────────────────
app.get('/api/config', (req, res) => res.json(CONFIG));

// ── Save submission ──────────────────────────────────────────────────────────
app.post('/api/submissions', (req, res) => {
  try {
    const { user, dept, week, season, prompt, response_text, result } = req.body;
    if (!user || !prompt || !result) {
      return res.status(400).json({ error: 'user, prompt, and result are required' });
    }
    const info = insertSubmission.run({
      user,
      dept: dept || '—',
      week: week || 1,
      season: season || 1,
      prompt,
      response_text: response_text || null,
      clarity: result.scores.clarity,
      context: result.scores.context,
      specificity: result.scores.specificity,
      technique: result.scores.technique,
      total: result.total,
      grade: result.grade,
      headline: result.headline || '',
      strengths: JSON.stringify(result.strengths || []),
      improvements: JSON.stringify(result.improvements || []),
      improved_prompt: result.improved_prompt || ''
    });
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    console.error('[db error]', e.message);
    res.status(500).json({ error: 'Failed to save submission' });
  }
});

// ── Leaderboard endpoint ─────────────────────────────────────────────────────
app.get('/api/leaderboard', (req, res) => {
  try {
    const view = req.query.view || 'weekly';
    const week = parseInt(req.query.week) || 1;
    const season = parseInt(req.query.season) || 1;
    let rows;

    if (view === 'weekly') {
      rows = db.prepare(`
        SELECT user, dept, MAX(total) as total, grade
        FROM submissions
        WHERE week = ? AND season = ?
        AND total = (
          SELECT MAX(s2.total) FROM submissions s2
          WHERE s2.user = submissions.user AND s2.week = ? AND s2.season = ?
        )
        GROUP BY user
        ORDER BY total DESC
        LIMIT 50
      `).all(week, season, week, season);
    } else if (view === 'quarterly') {
      // Quarter = 13 weeks. Determine quarter from current week.
      const quarterStart = Math.floor((week - 1) / 13) * 13 + 1;
      const quarterEnd = quarterStart + 12;
      rows = db.prepare(`
        SELECT user, dept,
          CAST(ROUND(AVG(best_total)) AS INTEGER) as total,
          CASE
            WHEN ROUND(AVG(best_total)) >= 80 THEN 'A'
            WHEN ROUND(AVG(best_total)) >= 60 THEN 'B'
            WHEN ROUND(AVG(best_total)) >= 40 THEN 'C'
            ELSE 'D'
          END as grade
        FROM (
          SELECT user, dept, week, MAX(total) as best_total
          FROM submissions
          WHERE season = ? AND week >= ? AND week <= ?
          GROUP BY user, week
        )
        GROUP BY user
        ORDER BY total DESC
        LIMIT 50
      `).all(season, quarterStart, quarterEnd);
    } else {
      // all-time: average of each user's best score per week
      rows = db.prepare(`
        SELECT user, dept,
          CAST(ROUND(AVG(best_total)) AS INTEGER) as total,
          CASE
            WHEN ROUND(AVG(best_total)) >= 80 THEN 'A'
            WHEN ROUND(AVG(best_total)) >= 60 THEN 'B'
            WHEN ROUND(AVG(best_total)) >= 40 THEN 'C'
            ELSE 'D'
          END as grade,
          COUNT(*) as weeks_played
        FROM (
          SELECT user, dept, week, season, MAX(total) as best_total
          FROM submissions
          GROUP BY user, week, season
        )
        GROUP BY user
        ORDER BY total DESC
        LIMIT 50
      `).all();
    }

    res.json({ view, rows });
  } catch (e) {
    console.error('[leaderboard error]', e.message);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

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
  console.log(`  Health: http://localhost:${PORT}/health`);
  console.log(`  DB:     ${DB_PATH}\n`);
  console.log('  Leave this terminal open while running the pilot.\n');
});
