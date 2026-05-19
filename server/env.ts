import { z } from 'npm:zod@latest';

export const env = z.object({
  // FIREWORKS_API_KEY: z.string(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
}).parse(Deno.env.toObject());
