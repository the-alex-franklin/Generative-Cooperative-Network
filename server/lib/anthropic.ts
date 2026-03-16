import { Try } from '../../src/utils/functions/try.ts';
import { env } from '../env.ts';
import type { ChatOptions, Message } from './fireworks.ts';

const BASE_URL = 'https://api.anthropic.com/v1';

function headers() {
  return {
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
}

// Anthropic doesn't accept 'system' role in the messages array —
// it goes as a top-level 'system' parameter instead.
function extractSystem(messages: Message[]): { system?: string; messages: Message[] } {
  const sysMsg = messages.find((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system') as Message[];
  return { system: sysMsg?.content, messages: rest };
}

export function chat(options: ChatOptions) {
  return Try(async () => {
    const { system, messages } = extractSystem(options.messages);
    const body: Record<string, unknown> = {
      model: options.model,
      messages,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.7,
    };
    if (system) body.system = system;

    const res = await fetch(`${BASE_URL}/messages`, {
      method: 'POST',
      headers: headers(),
      signal: options.signal,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status} [${options.model}]: ${await res.text()}`);
    const data = await res.json() as { content: [{ text: string }] };
    return data.content[0].text;
  });
}

export async function chatStream(
  options: ChatOptions,
  onToken: (token: string) => void,
): Promise<string> {
  const { system, messages } = extractSystem(options.messages);
  const body: Record<string, unknown> = {
    model: options.model,
    messages,
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.7,
    stream: true,
  };
  if (system) body.system = system;

  const res = await fetch(`${BASE_URL}/messages`, {
    method: 'POST',
    headers: headers(),
    signal: options.signal,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status} [${options.model}]: ${await res.text()}`);
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          const token: string = parsed.delta.text ?? '';
          if (token) {
            fullContent += token;
            onToken(token);
          }
        }
      } catch { /* incomplete chunk */ }
    }
  }
  return fullContent;
}
