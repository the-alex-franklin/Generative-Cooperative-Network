import { z } from 'npm:zod@latest';

export const env = z.object({
  // FIREWORKS_API_KEY: z.string(),
  ANTHROPIC_API_KEY: z.string(),
  OPENAI_API_KEY: z.string(),
}).parse(Deno.env.toObject());
