# QwenProxy

Local proxy server that interfaces with Qwen (chat.qwen.ai) using browser automation via Playwright.  
Provides an OpenAI-compatible API for chat interactions and tool execution.

---

## Features

- OpenAI-compatible API endpoints for chat completion
- Reasoning/Thinking support
- Tool execution support
- `/v1/responses` auto-execution loop for server-side tools
- Persistent browser session with login state
- Built with Hono and TypeScript

---

## Prerequisites

- Node.js v20 or later
- Playwright browsers

---

## Installation

```bash
npm install
npx playwright install
```

---

## Configuration

Create a `.env` file in the project root:

```env
PORT=3000
API_KEY=your_secret_api_key
QWEN_EMAIL=your_email@example.com
QWEN_PASSWORD=your_password
AUTO_EXECUTE_TOOLS=false
AUTO_EXECUTE_MAX_TURNS=10
SEARXNG_SEARCH_URL=http://searxng:8080/search
SEARXNG_TIMEOUT_MS=15000
```

- **API_KEY**: If set, all requests to `/v1/*` must include the header `Authorization: Bearer your_secret_api_key`.
- **QWEN_EMAIL/PASSWORD**: Required for automated login in Docker or headless environments.
- **AUTO_EXECUTE_TOOLS**: If `true`, `/v1/responses` executes registered server-side tools automatically.
- **SEARXNG_SEARCH_URL**: Internal SearXNG endpoint used by the built-in `web_search` tool.

---

## Usage

### Docker (Recommended)

1. Build and start the container:
   ```bash
   docker-compose up -d
   ```

The server will be available at `http://localhost:8080`.

### Coolify

This repository includes a compose file prepared to join the Coolify network.
The app exposes port `8080` internally and also serves a remote login controller at `/login`.

Use `/login` to open the Playwright session, inspect screenshots and send clicks/keys when the VPS cannot run an interactive browser.

### Local Execution

#### Login (Manual)

If you don't provide credentials in `.env`, you must log in manually once:
```bash
npm run login
```
This will open a browser window locally. In Coolify/VPS deployments, use `GET /login?key=...` instead.

#### Start the Server

```bash
npm start
```

The server runs by default at:

```txt
http://localhost:3000
```

---

## Testing

```bash
npm test
```

---

## API Endpoints

### `POST /v1/chat/completions`

OpenAI-compatible endpoint.

**Note**: If `API_KEY` is configured, include the Bearer token in your request headers.

Tool calls returned by this endpoint are not executed by the proxy. Clients should execute
`tool_calls` themselves, matching OpenAI Chat Completions behavior.

### `POST /v1/responses`

OpenAI-compatible Responses endpoint. It can execute registered server-side tools when
`auto_execute_tools` is enabled in the JSON body, via `X-Auto-Execute-Tools: true`, or
globally with `AUTO_EXECUTE_TOOLS=true`.

Example:

```bash
curl http://localhost:3000/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_secret_api_key" \
  -d '{
    "model": "qwen3.6-plus-no-thinking",
    "auto_execute_tools": true,
    "input": "Pesquise na web por TypeScript e responda com fontes."
  }'
```

The built-in `web_search` tool uses SearXNG and requires the proxy to reach
`SEARXNG_SEARCH_URL`, defaulting to `http://searxng:8080/search`.

#### Models
- `qwen3.6-plus` (with thinking)
- `qwen3.6-plus-no-thinking`

---

## Project Structure

```txt
.
├── src/
│   ├── index.ts           # Server entry
│   ├── routes/            # API routes
│   ├── services/          # Qwen & Playwright services
│   ├── tools/             # Tool execution
│   └── utils/             # Utilities
├── qwen_profile/          # Browser profile storage
```

---

## License

ISC

---

# Disclaimer

This project is provided strictly for educational and research purposes.

The authors do not encourage or endorse:

- Misuse
- Unauthorized automation
- Abuse of third-party services
- Violations of platform Terms of Service

Users are solely responsible for how they use this software, including compliance with applicable laws, regulations, and service agreements.

This repository is intended to demonstrate concepts related to:

- Browser automation
- Session management
- OpenAI-compatible runtime architectures

Use at your own risk.
