/**
 * Run with: deno run -A --env-file server/test-models.ts
 * Tests a list of model IDs against the Fireworks API to see which ones work.
 */

// const BASE_URL = 'https://api.fireworks.ai/inference/v1';
// const API_KEY = Deno.env.get('FIREWORKS_API_KEY');

// // The three models currently used by gcn.ts
// const CANDIDATES = [
//   'accounts/fireworks/models/deepseek-v3p2',
//   'accounts/fireworks/models/llama-v3p3-70b-instruct',
//   'accounts/fireworks/models/qwen3-8b',
// ];

// async function testModel(model: string): Promise<void> {
//   // Test 1: non-streaming (used by judge)
//   try {
//     const res = await fetch(`${BASE_URL}/chat/completions`, {
//       method: 'POST',
//       headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         model,
//         messages: [
//           { role: 'system', content: 'You are a helpful assistant.' },
//           { role: 'user', content: 'Say "ok"' },
//         ],
//         max_tokens: 10,
//         temperature: 0.7,
//       }),
//     });
//     if (res.ok) {
//       const data = await res.json();
//       console.log(`✓ non-stream  ${model}  → "${data.choices?.[0]?.message?.content?.trim()}"`);
//     } else {
//       const err = await res.json().catch(() => ({}));
//       console.log(
//         `✗ non-stream  ${model}  ${res.status}: ${
//           (err as { error?: { message?: string } }).error?.message
//         }`,
//       );
//     }
//   } catch (e) {
//     console.log(`✗ non-stream  ${model}  fetch error: ${e}`);
//   }

//   // Test 2: streaming (used by left/right)
//   try {
//     const res = await fetch(`${BASE_URL}/chat/completions`, {
//       method: 'POST',
//       headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         model,
//         messages: [
//           { role: 'system', content: 'You are a helpful assistant.' },
//           { role: 'user', content: 'Say "ok"' },
//         ],
//         max_tokens: 10,
//         temperature: 0.7,
//         stream: true,
//       }),
//     });
//     if (!res.ok) {
//       const err = await res.json().catch(() => ({}));
//       console.log(
//         `✗ stream      ${model}  ${res.status}: ${
//           (err as { error?: { message?: string } }).error?.message
//         }`,
//       );
//       return;
//     }
//     let output = '';
//     const reader = res.body!.getReader();
//     const dec = new TextDecoder();
//     let buf = '';
//     while (true) {
//       const { done, value } = await reader.read();
//       if (done) break;
//       buf += dec.decode(value, { stream: true });
//       const lines = buf.split('\n');
//       buf = lines.pop() ?? '';
//       for (const line of lines) {
//         if (!line.startsWith('data: ')) continue;
//         const d = line.slice(6).trim();
//         if (d === '[DONE]') break;
//         try {
//           output += JSON.parse(d).choices?.[0]?.delta?.content ?? '';
//         } catch { /* skip */ }
//       }
//     }
//     console.log(`✓ stream      ${model}  → "${output.trim()}"`);
//   } catch (e) {
//     console.log(`✗ stream      ${model}  fetch error: ${e}`);
//   }
// }

// for (const model of CANDIDATES) {
//   await testModel(model);
//   console.log();
// }

// Quick Anthropic sanity check
console.log('--- Anthropic ---');
try {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Say "ok"' }],
    }),
  });
  const data = await res.json();
  if (res.ok) {
    console.log(`✓ claude-haiku-4-5  → "${data.content?.[0]?.text?.trim()}"`);
  } else {
    console.log(`✗ claude-haiku-4-5  ${res.status}: ${JSON.stringify(data)}`);
  }
} catch (e) {
  console.log(`✗ claude-haiku-4-5  fetch error: ${e}`);
}
