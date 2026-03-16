import { Hono } from 'hono'

const app = new Hono()

// Add your API routes here
app.get('/api/hello', (c) => c.json({ message: 'Hello from Hono!' }))

Deno.serve({ port: 8000 }, app.fetch)
