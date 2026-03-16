import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { type GCNConfig, runGCN } from './lib/gcn.ts'
import { createSession, getSession, subscribe } from './lib/session.ts'

const app = new Hono()

app.get('/api/hello', (c) => c.json({ message: 'Hello from Hono!' }))

app.post('/api/gcn/start', async (c) => {
  const body = await c.req.json<{ question: string } & GCNConfig>()
  if (!body.question?.trim()) return c.json({ error: 'question is required' }, 400)

  const sessionId = crypto.randomUUID()
  const session = createSession(sessionId)

  // fire and forget — streams tokens into session channels as they arrive
  runGCN(session, body.question, {
    maxIterations: body.maxIterations,
    maxTokensPerTurn: body.maxTokensPerTurn,
    temperature: body.temperature,
  })

  return c.json({ sessionId })
})

app.get('/api/gcn/stream/:side/:sessionId', (c) => {
  const side = c.req.param('side') as 'left' | 'right'
  const sessionId = c.req.param('sessionId')

  if (side !== 'left' && side !== 'right') {
    return c.json({ error: 'side must be left or right' }, 400)
  }

  const session = getSession(sessionId)
  if (!session) return c.json({ error: 'session not found' }, 404)

  return streamSSE(c, (stream) =>
    new Promise<void>((resolve) => {
      const unsubscribe = subscribe(session, side, async (event) => {
        try {
          await stream.writeSSE({ data: JSON.stringify(event) })
        } catch {
          unsubscribe?.()
          resolve()
          return
        }
        if (event.type === 'done' || event.type === 'error') {
          unsubscribe?.()
          resolve()
        }
      })
    }))
})

Deno.serve({ port: 8000 }, app.fetch)
