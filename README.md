# DeepsProxy (Qwen Edition)

Local proxy server that interfaces with Qwen (chat.qwen.ai) using browser automation via Playwright.  
Provides an OpenAI-compatible API for chat interactions and tool execution.

---

## Features

- OpenAI-compatible API endpoints for chat completion
- Reasoning/Thinking support
- Tool execution support
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
```

- **API_KEY**: If set, all requests to `/v1/*` must include the header `Authorization: Bearer your_secret_api_key`.
- **QWEN_EMAIL/PASSWORD**: Required for automated login in Docker or headless environments.

---

## Usage

### Docker (Recommended)

1. Build and start the container:
   ```bash
   docker-compose up -d
   ```

The server will be available at `http://localhost:3000`.

### Local Execution

#### Login (Manual)

If you don't provide credentials in `.env`, you must log in manually once:
```bash
npm run login
```
This will open a browser window. Log in and then close it.

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
