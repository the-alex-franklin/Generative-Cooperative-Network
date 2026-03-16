import { Try } from '../../src/utils/functions/try.ts'

const BASE_URL = 'https://api.fireworks.ai/inference/v1'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  model: string
  messages: Message[]
  maxTokens?: number
  temperature?: number
}

function headers() {
  return {
    Authorization: `Bearer ${Deno.env.get('FIREWORKS_API_KEY')}`,
    'Content-Type': 'application/json',
  }
}

export function chat(options: ChatOptions) {
  return Try(async () => {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
      }),
    })
    if (!res.ok) throw new Error(`Fireworks ${res.status}: ${await res.text()}`)
    const data = await res.json() as { choices: [{ message: { content: string } }] }
    return data.choices[0].message.content
  })
}

export async function chatStream(
  options: ChatOptions,
  onToken: (token: string) => void,
): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.7,
      stream: true,
    }),
  })
  if (!res.ok) throw new Error(`Fireworks ${res.status}: ${await res.text()}`)
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let fullContent = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') return fullContent
      try {
        const parsed = JSON.parse(data)
        const token: string = parsed.choices?.[0]?.delta?.content ?? ''
        if (token) {
          fullContent += token
          onToken(token)
        }
      } catch { /* incomplete chunk */ }
    }
  }
  return fullContent
}
