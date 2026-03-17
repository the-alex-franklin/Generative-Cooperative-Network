import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { runGCN } from './lib/gcn.ts';
import { abortSession, createSession, getSession, pushEvent, subscribe } from './lib/session.ts';

const app = new Hono();

app.get('/api/hello', (c) => c.json({ message: 'Hello from Hono!' }));

app.post('/api/gcn/start', async (c) => {
  const body = await c.req.json<{
    question: string;
    anthropicKey?: string;
    openaiKey?: string;
    maxIterations?: number;
    maxTokens?: number;
    temperature?: number;
    convergenceThreshold?: number;
  }>();
  if (!body.question?.trim()) return c.json({ error: 'question is required' }, 400);

  const sessionId = crypto.randomUUID();
  const session = createSession(sessionId, {
    anthropic: body.anthropicKey?.trim() || undefined,
    openai: body.openaiKey?.trim() || undefined,
  });

  // fire and forget — streams tokens into session channels as they arrive
  runGCN(session, body.question, {
    maxIterations: body.maxIterations,
    maxTokens: body.maxTokens,
    temperature: body.temperature,
    convergenceThreshold: body.convergenceThreshold,
  })
    .then((result) => {
      if (!result.success) {
        console.error('[GCN error]', result.error);
        pushEvent(session, 'left', { type: 'error', message: result.error.message });
        pushEvent(session, 'right', { type: 'error', message: result.error.message });
        pushEvent(session, 'hypervisor', { type: 'error', message: result.error.message });
      }
    });

  return c.json({ sessionId });
});

app.get('/api/gcn/stream/:side/:sessionId', (c) => {
  const side = c.req.param('side') as 'left' | 'right' | 'hypervisor';
  const sessionId = c.req.param('sessionId');

  if (side !== 'left' && side !== 'right' && side !== 'hypervisor') {
    return c.json({ error: 'side must be left, right, or hypervisor' }, 400);
  }

  const session = getSession(sessionId);
  if (!session) return c.json({ error: 'session not found' }, 404);

  return streamSSE(c, (stream) =>
    new Promise<void>((resolve) => {
      const unsubscribe = subscribe(session, side, async (event) => {
        try {
          await stream.writeSSE({ data: JSON.stringify(event) });
        } catch {
          unsubscribe?.();
          resolve();
          return;
        }
        if (event.type === 'done' || event.type === 'error') {
          unsubscribe?.();
          resolve();
        }
      });
    }));
});

app.post('/api/gcn/abort/:sessionId', (c) => {
  const session = getSession(c.req.param('sessionId'));
  if (!session) return c.json({ error: 'session not found' }, 404);
  abortSession(session);
  return c.json({ ok: true });
});

Deno.serve({ port: 8000 }, app.fetch);
