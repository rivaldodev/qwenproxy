/*
 * File: index.ts
 * Project: qwenproxy
 * Author: Pedro Farias
 * Created: 2026-05-09
 * 
 * Last Modified: Sat May 09 2026
 * Modified By: Pedro Farias
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { chatCompletions } from './routes/chat.ts';
import { loginClick, loginKey, loginPage, loginScreenshot, loginType } from './routes/login.ts';
import { fetchQwenModels } from './services/qwen.ts';
import * as dotenv from 'dotenv';
import { initPlaywright } from './services/playwright.ts';

dotenv.config();

export const app = new Hono();

app.use('*', cors());

// API Key protection middleware
app.use('/v1/*', async (c, next) => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return await next();
  }

  const authorization = c.req.header('authorization') || '';
  const bearerKey = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  const headerKey = c.req.header('x-api-key') || '';
  const queryKey = new URL(c.req.url).searchParams.get('key') || '';

  if (bearerKey === apiKey || headerKey === apiKey || queryKey === apiKey) {
    return await next();
  }

  return c.text('Unauthorized', 401);
});

// Basic health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Web login helper for Coolify/VPS environments
app.get('/login', loginPage);
app.get('/login/screenshot', loginScreenshot);
app.post('/login/click', loginClick);
app.post('/login/type', loginType);
app.post('/login/key', loginKey);

// OpenAI compatible routes
app.post('/v1/chat/completions', chatCompletions);

app.get('/v1/models', async (c) => {
  try {
    const models = await fetchQwenModels();
    return c.json({
      object: 'list',
      data: models
    });
  } catch (err: any) {
    return c.json({ error: { message: err.message } }, 500);
  }
});

// Initialize playwright when server starts
import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  initPlaywright().then(() => {
    console.log('Playwright initialized.');
    const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
    console.log(`Server is running on port ${port}`);

    serve({
      fetch: app.fetch,
      port,
      hostname: '0.0.0.0'
    });
  }).catch((err: any) => {
    console.error('Failed to initialize playwright:', err);
    process.exit(1);
  });
}
