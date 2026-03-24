# Prompt League — Local Proxy

A minimal Node.js server that lets the POC HTML file call the Anthropic API
without exposing your API key in the browser.

## Setup (one time)

```bash
# 1. Install dependencies
npm install

# 2. Get your Anthropic API key from https://console.anthropic.com
#    Then start the server:
ANTHROPIC_API_KEY=sk-ant-... node server.js

# Windows PowerShell:
$env:ANTHROPIC_API_KEY="sk-ant-..."; node server.js

# Windows CMD:
set ANTHROPIC_API_KEY=sk-ant-... && node server.js
```

## Running the pilot

1. Copy `prompt_competition_poc.html` into this folder (same directory as server.js)
2. Start the proxy with your API key (above)
3. Open http://localhost:3001 in your browser
4. Share the URL with pilot participants on the same network,
   or use a tool like ngrok to expose it publicly for remote pilots:

```bash
# If using ngrok (optional, for remote access):
npx ngrok http 3001
# Share the https://xxxx.ngrok.io URL with participants
```

## How it works

```
Browser POC  →  POST /api/score  →  proxy server  →  Anthropic API
                (no key needed)      (key lives here)
```

The proxy adds the API key header server-side, forwards the request,
and streams the response back. The browser never sees the key.

## Stopping

Ctrl+C in the terminal running server.js.
