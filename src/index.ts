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
import { models } from './routes/models.ts';
import { responses } from './routes/responses.ts';
import * as dotenv from 'dotenv';
import { initPlaywright } from './services/playwright.ts';

dotenv.config();

export const app = new Hono();

app.use('*', cors());

// API Key protection middleware
async function apiKeyAuth(c: any, next: any) {
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
}

app.use('/v1/*', apiKeyAuth);
app.use('/models', apiKeyAuth);
app.use('/models/*', apiKeyAuth);

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
app.post('/chat/completions', chatCompletions);
app.post('/v1/responses', responses);
app.post('/responses', responses);
app.route('/v1/models', models);
app.route('/models', models);

app.notFound((c) => {
  return c.json({
    error: {
      message: `Route not found: ${c.req.method} ${new URL(c.req.url).pathname}`,
      type: 'invalid_request_error',
      code: 'route_not_found'
    }
  }, 404);
});

// Initialize playwright when server starts
import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  initPlaywright().then(() => {
    console.log('Playwright initialized.');
    const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
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
