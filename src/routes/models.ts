import { Hono } from 'hono';
import { fetchQwenModels } from '../services/qwen.ts';

function modelObject(id: string) {
  return {
    id,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'qwen',
    permission: [],
    root: id,
    parent: null
  };
}

async function listModels() {
  const remoteModels = await fetchQwenModels();
  return remoteModels.map((model: any) => ({
    ...modelObject(model.id),
    ...model
  }));
}

export const models = new Hono();

models.get('/', async (c) => {
  try {
    return c.json({
      object: 'list',
      data: await listModels()
    });
  } catch (error: any) {
    return c.json({
      error: {
        message: error?.message || 'Failed to fetch models from Qwen',
        type: 'server_error',
        code: 'models_unavailable'
      }
    }, 500);
  }
});

models.get('/:model', async (c) => {
  const id = c.req.param('model');
  try {
    const availableModels = await listModels();
    const model = availableModels.find((item: any) => item.id === id);
    if (!model) {
      return c.json({
        error: {
          message: `Model not found: ${id}`,
          type: 'invalid_request_error',
          code: 'model_not_found'
        }
      }, 404);
    }

    return c.json(model);
  } catch (error: any) {
    return c.json({
      error: {
        message: error?.message || 'Failed to fetch model from Qwen',
        type: 'server_error',
        code: 'models_unavailable'
      }
    }, 500);
  }
});
