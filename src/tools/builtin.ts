import { registry } from './registry.ts';

function searchEndpoint(): string {
  return process.env.SEARXNG_SEARCH_URL?.trim() || 'http://searxng:8080/search';
}

function searchTimeoutMs(): number {
  const value = Number(process.env.SEARXNG_TIMEOUT_MS || '15000');
  return Number.isFinite(value) && value > 0 ? value : 15000;
}

export function registerBuiltinTools(): void {
  if (!registry.has('web_search')) {
    registry.register(
      'web_search',
      'Search the web and return concise results with titles, URLs, and snippets.',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query.'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return.'
          }
        },
        required: ['query']
      },
      async (args) => {
        const query = String(args.query || '').trim();
        if (!query) {
          return JSON.stringify({ error: 'Missing query' });
        }

        const limit = Math.max(1, Math.min(Number(args.limit || 5), 10));
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), searchTimeoutMs());

        try {
          const url = new URL(searchEndpoint());
          url.searchParams.set('q', query);
          url.searchParams.set('format', 'json');

          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) {
            return JSON.stringify({
              error: 'Search request failed',
              status: response.status,
              statusText: response.statusText
            });
          }

          const data = await response.json();
          const results = Array.isArray(data?.results) ? data.results : [];

          return JSON.stringify({
            query,
            results: results.slice(0, limit).map((result: any) => ({
              title: result.title || '',
              url: result.url || '',
              content: result.content || result.snippet || ''
            }))
          }, null, 2);
        } finally {
          clearTimeout(timeout);
        }
      }
    );
  }
}
