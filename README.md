# GCN — Generative Cooperative Network

Two large language models debate a question through structured rounds of critique and revision. A third model judges convergence. A fourth synthesizes the result.

## How it works

1. **Round 0** — both models answer the question independently
2. **Critique phase** — each model critiques the other's answer
3. **Revision phase** — each model revises its own answer using the critique it received
4. Rounds repeat until the judge scores the answers above a convergence threshold, stagnation is detected, or the iteration limit is hit
5. Each model presents a **Final Answer**
6. A **Synthesis** model integrates both into a single best answer

## Models

| Role | Provider | Model |
|---|---|---|
| Left brain (analytical) | OpenAI | gpt-4o-mini |
| Right brain (abstract) | Anthropic | claude-haiku-4-5 |
| Judge | Fireworks | qwen3-8b |
| Synthesis | OpenAI | gpt-4o-mini |

## Stack

- **Backend** — Deno + Hono, SSE streaming
- **Frontend** — React + Vite + UnoCSS

## Setup

```
cp .env.example .env
# add FIREWORKS_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY
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
