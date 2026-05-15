export type PromptToolDefinition = {
  name: string;
  description: string;
  parameters: unknown;
};

export function normalizePromptTools(tools: unknown): PromptToolDefinition[] {
  if (!Array.isArray(tools)) return [];

  const normalized: PromptToolDefinition[] = [];

  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;

    const value = tool as any;
    const fn = value.function && typeof value.function === 'object'
      ? value.function
      : value;
    const name = typeof fn.name === 'string' ? fn.name.trim() : '';

    if (!name) continue;

    normalized.push({
      name,
      description: typeof fn.description === 'string' ? fn.description : '',
      parameters: fn.parameters || { type: 'object', properties: {} }
    });
  }

  return normalized;
}

export function toolCallToTag(toolCall: any): string {
  const fn = toolCall?.function && typeof toolCall.function === 'object'
    ? toolCall.function
    : toolCall;
  const name = typeof fn?.name === 'string' ? fn.name.trim() : '';

  if (!name) return '';

  let args = fn.arguments || {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }

  return `<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`;
}
