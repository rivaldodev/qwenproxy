import { Context } from 'hono';
import {
  captureQwenLoginScreenshot,
  clickQwenLoginPage,
  ensureQwenLoginPage,
  pressQwenLoginKey,
  typeQwenLoginText,
  withPlaywrightUiLock
} from '../services/playwright.ts';

function getConfiguredApiKey(): string {
  return process.env.API_KEY || '';
}

function getProvidedAuthKey(c: Context): string {
  const queryKey = new URL(c.req.url).searchParams.get('key') || '';
  const authorization = c.req.header('authorization') || '';
  const bearerKey = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  const headerKey = c.req.header('x-api-key') || '';
  return queryKey || bearerKey || headerKey;
}

function requireLoginAuth(c: Context): Response | null {
  const configuredKey = getConfiguredApiKey();
  if (!configuredKey) {
    return null;
  }

  const providedKey = getProvidedAuthKey(c);
  if (providedKey === configuredKey) {
    return null;
  }

  return c.text('Unauthorized', 401);
}

function authQuerySuffix(c: Context): string {
  const configuredKey = getConfiguredApiKey();
  if (!configuredKey) {
    return '';
  }

  const providedKey = getProvidedAuthKey(c);
  return providedKey ? `?key=${encodeURIComponent(providedKey)}` : '';
}

function renderLoginPage(c: Context) {
  const authSuffix = authQuerySuffix(c);

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>QwenProxy Login</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #08111f;
        --panel: #0f1729;
        --panel-2: #121c33;
        --text: #e6edf7;
        --muted: #98a5bd;
        --line: rgba(148, 163, 184, 0.16);
        --accent: #64d7c8;
        --accent-2: #65a6ff;
        --danger: #ff748d;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        background:
          radial-gradient(circle at top left, rgba(100, 215, 200, 0.12), transparent 28%),
          radial-gradient(circle at top right, rgba(101, 166, 255, 0.12), transparent 26%),
          linear-gradient(180deg, #050b14 0%, var(--bg) 100%);
        color: var(--text);
        padding: 24px;
      }
      .shell {
        max-width: 1280px;
        margin: 0 auto;
        display: grid;
        gap: 18px;
      }
      .topbar, .panel {
        background: rgba(15, 23, 41, 0.92);
        border: 1px solid var(--line);
        border-radius: 22px;
        box-shadow: 0 28px 80px rgba(0, 0, 0, 0.35);
      }
      .topbar {
        padding: 18px 20px;
        display: flex;
        gap: 16px;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
      }
      .title h1 {
        margin: 0;
        font-size: 1.45rem;
      }
      .title p {
        margin: 6px 0 0;
        color: var(--muted);
        line-height: 1.5;
      }
      .status {
        min-height: 22px;
        color: var(--muted);
        font-size: 0.95rem;
      }
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
        gap: 18px;
      }
      @media (max-width: 980px) {
        .grid { grid-template-columns: 1fr; }
      }
      .panel {
        overflow: hidden;
      }
      .panel-head {
        padding: 16px 18px;
        border-bottom: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.02);
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .panel-head strong {
        font-size: 0.98rem;
      }
      .panel-body {
        padding: 18px;
      }
      .screen-wrap {
        position: relative;
        border-radius: 18px;
        overflow: hidden;
        border: 1px solid var(--line);
        background: #050b14;
      }
      .screen-wrap::before {
        content: 'Click on the screen to send mouse coordinates';
        position: absolute;
        left: 14px;
        top: 14px;
        z-index: 1;
        font-size: 12px;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        color: rgba(230, 237, 247, 0.72);
        background: rgba(5, 11, 20, 0.72);
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 999px;
        padding: 8px 12px;
        pointer-events: none;
      }
      #screen {
        display: block;
        width: 100%;
        height: auto;
        cursor: crosshair;
        user-select: none;
      }
      .controls {
        display: grid;
        gap: 14px;
      }
      label {
        display: grid;
        gap: 8px;
        color: var(--muted);
        font-size: 0.92rem;
      }
      input[type="text"] {
        width: 100%;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: rgba(8, 13, 24, 0.86);
        color: var(--text);
        padding: 14px 16px;
        outline: none;
      }
      input[type="text"]:focus {
        border-color: rgba(101, 166, 255, 0.52);
        box-shadow: 0 0 0 3px rgba(101, 166, 255, 0.14);
      }
      .button-row {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      button {
        border: 0;
        border-radius: 14px;
        padding: 12px 14px;
        font-weight: 700;
        color: #07121a;
        background: linear-gradient(135deg, var(--accent), var(--accent-2));
        cursor: pointer;
      }
      button.secondary {
        background: rgba(255, 255, 255, 0.06);
        color: var(--text);
        border: 1px solid var(--line);
      }
      .key-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .muted {
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.5;
      }
      .footer {
        color: var(--muted);
        font-size: 0.9rem;
      }
      code {
        background: rgba(255, 255, 255, 0.06);
        padding: 0.16rem 0.38rem;
        border-radius: 8px;
      }
      a { color: #8ab4ff; }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="topbar">
        <div class="title">
          <h1>QwenProxy Login</h1>
          <p>Use esta página para controlar a sessão do Playwright dentro do container e autenticar o Qwen sem depender de navegador local.</p>
        </div>
        <div class="status" id="status">Carregando screenshot...</div>
      </section>

      <div class="grid">
        <section class="panel">
          <div class="panel-head">
            <strong>Sessão remota</strong>
            <div class="button-row">
              <button type="button" class="secondary" id="refresh-btn">Atualizar</button>
            </div>
          </div>
          <div class="panel-body">
            <div class="screen-wrap">
              <img id="screen" alt="Playwright screen" />
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <strong>Controles</strong>
          </div>
          <div class="panel-body controls">
            <label>
              Digitar texto
              <input id="text-input" type="text" placeholder="Texto para o campo focado" />
            </label>
            <div class="button-row">
              <button type="button" id="type-btn">Digitar</button>
            </div>
            <div class="key-grid">
              <button type="button" data-key="Enter">Enter</button>
              <button type="button" data-key="Tab">Tab</button>
              <button type="button" data-key="Backspace">Backspace</button>
              <button type="button" data-key="Escape">Escape</button>
            </div>
            <div class="key-grid">
              <button type="button" data-key="ArrowUp">ArrowUp</button>
              <button type="button" data-key="ArrowDown">ArrowDown</button>
              <button type="button" data-key="ArrowLeft">ArrowLeft</button>
              <button type="button" data-key="ArrowRight">ArrowRight</button>
            </div>
            <div class="muted">
              O screenshot é renovado automaticamente a cada 2,5 segundos. Clique na imagem para enviar coordenadas reais ao Playwright.
            </div>
            <div class="footer">
              Se o navegador abrir na tela errada, clique em <code>Atualizar</code> ou recarregue a página.
            </div>
          </div>
        </section>
      </div>
    </main>

    <script>
      const authSuffix = ${JSON.stringify(authSuffix)};
      const screen = document.getElementById('screen');
      const status = document.getElementById('status');
      const refreshBtn = document.getElementById('refresh-btn');
      const textInput = document.getElementById('text-input');
      const typeBtn = document.getElementById('type-btn');
      let currentScreenUrl = '';

      function setStatus(message, isError = false) {
        status.textContent = message;
        status.style.color = isError ? '#ff9cb0' : '#98a5bd';
      }

      function apiUrl(path) {
        return path + authSuffix;
      }

      function nextScreenUrl() {
        const base = apiUrl('/login/screenshot');
        return base + (base.includes('?') ? '&' : '?') + 't=' + Date.now();
      }

      async function refresh() {
        try {
          setStatus('Atualizando screenshot...');
          const response = await fetch(nextScreenUrl(), { cache: 'no-store' });
          if (!response.ok) {
            throw new Error('HTTP ' + response.status);
          }

          const blob = await response.blob();
          const nextUrl = URL.createObjectURL(blob);
          if (currentScreenUrl) {
            URL.revokeObjectURL(currentScreenUrl);
          }
          currentScreenUrl = nextUrl;
          screen.src = nextUrl;
          setStatus('Pronto para controlar o navegador.');
        } catch (error) {
          setStatus('Falha ao atualizar screenshot: ' + error.message, true);
        }
      }

      async function postJson(path, payload) {
        const response = await fetch(apiUrl(path), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(body || ('HTTP ' + response.status));
        }
      }

      screen.addEventListener('click', async (event) => {
        try {
          const rect = screen.getBoundingClientRect();
          const x = Math.round((event.clientX - rect.left) * (screen.naturalWidth / rect.width));
          const y = Math.round((event.clientY - rect.top) * (screen.naturalHeight / rect.height));
          setStatus('Enviando clique em ' + x + ', ' + y + '...');
          await postJson('/login/click', { x, y });
          await refresh();
        } catch (error) {
          setStatus('Falha ao clicar: ' + error.message, true);
        }
      });

      refreshBtn.addEventListener('click', refresh);

      typeBtn.addEventListener('click', async () => {
        try {
          const text = textInput.value || '';
          setStatus('Digitando texto...');
          await postJson('/login/type', { text });
          textInput.value = '';
          await refresh();
        } catch (error) {
          setStatus('Falha ao digitar: ' + error.message, true);
        }
      });

      textInput.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          typeBtn.click();
        }
      });

      document.querySelectorAll('[data-key]').forEach((button) => {
        button.addEventListener('click', async () => {
          try {
            const key = button.getAttribute('data-key');
            setStatus('Enviando tecla ' + key + '...');
            await postJson('/login/key', { key });
            await refresh();
          } catch (error) {
            setStatus('Falha ao enviar tecla: ' + error.message, true);
          }
        });
      });

      setInterval(refresh, 2500);
      refresh();
    </script>
  </body>
</html>`;
}

function parseKeyedPayload(c: Context): any {
  return c.req.json().catch(async () => {
    const form = await c.req.formData();
    return Object.fromEntries(form.entries());
  });
}

export async function loginPage(c: Context) {
  const auth = requireLoginAuth(c);
  if (auth) {
    return auth;
  }

  await withPlaywrightUiLock(async () => {
    await ensureQwenLoginPage(true);
  });

  return c.html(renderLoginPage(c));
}

export async function loginScreenshot(c: Context) {
  const auth = requireLoginAuth(c);
  if (auth) {
    return auth;
  }

  try {
    const image = await withPlaywrightUiLock(async () => {
      await ensureQwenLoginPage(true);
      return await captureQwenLoginScreenshot();
    });

    return new Response(image, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store'
      }
    });
  } catch (error: any) {
    return new Response(error?.message || 'Failed to capture screenshot', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

export async function loginClick(c: Context) {
  const auth = requireLoginAuth(c);
  if (auth) {
    return auth;
  }

  try {
    const payload = await parseKeyedPayload(c);
    const x = Number(payload.x);
    const y = Number(payload.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return c.json({ error: 'Invalid coordinates' }, 400);
    }

    await withPlaywrightUiLock(async () => {
      await ensureQwenLoginPage(true);
      await clickQwenLoginPage(x, y);
    });

    return c.json({ ok: true });
  } catch (error: any) {
    return c.json({ error: error?.message || 'Failed to click' }, 500);
  }
}

export async function loginType(c: Context) {
  const auth = requireLoginAuth(c);
  if (auth) {
    return auth;
  }

  try {
    const payload = await parseKeyedPayload(c);
    const text = typeof payload.text === 'string' ? payload.text : '';

    await withPlaywrightUiLock(async () => {
      await ensureQwenLoginPage(true);
      await typeQwenLoginText(text);
    });

    return c.json({ ok: true });
  } catch (error: any) {
    return c.json({ error: error?.message || 'Failed to type text' }, 500);
  }
}

export async function loginKey(c: Context) {
  const auth = requireLoginAuth(c);
  if (auth) {
    return auth;
  }

  try {
    const payload = await parseKeyedPayload(c);
    const key = typeof payload.key === 'string' ? payload.key : '';

    if (!key) {
      return c.json({ error: 'Invalid key' }, 400);
    }

    await withPlaywrightUiLock(async () => {
      await ensureQwenLoginPage(true);
      await pressQwenLoginKey(key);
    });

    return c.json({ ok: true });
  } catch (error: any) {
    if (error?.message === 'Invalid key') {
      return c.json({ error: 'Invalid key' }, 400);
    }

    return c.json({ error: error?.message || 'Failed to press key' }, 500);
  }
}