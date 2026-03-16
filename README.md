# GCN — Generative Cooperative Network

Two large language models converge on the best possible answer to a question through successive rounds of mutual rewriting. A third model monitors convergence and presents the final unified result.

## How it works

1. **Round 0** — both models answer the question independently
2. **Each subsequent round** — each model rewrites the other's answer from its own perspective, keeping what's sound and improving what isn't
3. Rounds repeat until the hypervisor scores the answers above a convergence threshold, stagnation is detected, or the iteration limit is hit
4. Each model presents a **Final Answer**
5. The **Hypervisor** presents the unified result

## Models

| Role | Provider | Model |
|---|---|---|
| Left brain (analytical) | Anthropic | claude-haiku-4-5 |
| Right brain (abstract) | OpenAI | gpt-4o-mini |
| Hypervisor | Anthropic | claude-haiku-4-5 |

## Stack

- **Backend** — Deno + Hono, SSE streaming
- **Frontend** — React + Vite + UnoCSS

## Setup

```
cp .env.example .env
# add ANTHROPIC_API_KEY and OPENAI_API_KEY
```

```
deno task api   # API server on :8000
deno task dev   # Vite dev server on :5173
```
```

## Deploy

Build production assets:

```
$ deno task build
```
