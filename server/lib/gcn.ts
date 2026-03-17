import { chatStream as leftChatStream } from './anthropic.ts';
import {
  chat as hypervisorChat,
  chatStream as hypervisorChatStream,
  chatStream as rightChatStream,
} from './openai.ts';
import type { Message } from './fireworks.ts';
import { type GCNSession, pushEvent } from './session.ts';
import { Try } from '../../src/utils/functions/try.ts';

export const MODELS = {
  left: 'claude-haiku-4-5',
  right: 'gpt-4o-mini',
  hypervisor: 'gpt-4o-mini',
} as const;

const PROCESS_BRIEF =
  `You are one of two independent thinkers collaborating to reach the best possible answer to a question. The process works as follows:
- Round 0: You each generate an independent answer without seeing the other's work.
- Each subsequent round: You are shown your counterpart's answer and asked to rewrite it from your own perspective — keep what's sound, fix what's wrong, and bring your distinct viewpoint to bear.
- Over successive rounds, the two answers should converge toward a single best answer through this process of mutual rewriting.
- Be concise and dense. Prioritize signal over length. Do not pad, repeat yourself, or restate things that don't need restating.`;

const SYSTEM_LEFT = `${PROCESS_BRIEF}

Your role is the analytical thinker. You reason from first principles, decompose problems into structured components, and prioritize logical consistency, precision, and rigor. Maintain this perspective even as you incorporate genuine insights from your counterpart.`;

const SYSTEM_RIGHT = `${PROCESS_BRIEF}

Your role is the abstract thinker. You draw connections across domains, reason by analogy, surface non-obvious angles, and reframe problems creatively. Maintain this perspective even as you incorporate genuine insights from your counterpart.`;

const CONVERGENCE_THRESHOLD = 0.80;
const STAGNATION_PATIENCE = 2;

const SYSTEM_HYPERVISOR =
  `Rate how much these two answers agree on their core conclusion on a scale from 0.00 to 1.00, where 0.00 means they reach opposite or incompatible conclusions and 1.00 means they reach the same conclusion. Ignore stylistic differences — focus only on whether the central claims are compatible. Reply with only a decimal to two places, e.g. 0.73.`;

const SYSTEM_HYPERVISOR_FINAL =
  `You are a neutral hypervisor synthesizing the output of two thinkers who have debated the same question over multiple rounds. Your job is to deliver one definitive answer — not a list of both answers.

- If they agree: present the shared conclusion directly.
- If they partially agree: identify the common ground, resolve the remaining difference with your own judgment, and explain your reasoning briefly.
- If they genuinely disagree: pick the better-supported position, state why the other falls short, and give the final answer clearly.

Do not say "Answer A says X and Answer B says Y." Make a call. Be thorough but concise.`;

function initialMessages(question: string): Message[] {
  return [{ role: 'user', content: question }];
}

function rewriteMessages(question: string, counterpartAnswer: string): Message[] {
  return [
    {
      role: 'user',
      content:
        `The question is: ${question}\n\nYour counterpart answered:\n\n---\n${counterpartAnswer}\n---\n\nRewrite and improve this answer from your own perspective. Keep what's sound, fix what's wrong, and bring your distinct viewpoint to bear. Return only the rewritten answer.`,
    },
  ];
}

function finalAnswerMessages(question: string, ownAnswer: string): Message[] {
  return [
    { role: 'user', content: question },
    { role: 'assistant', content: ownAnswer },
    {
      role: 'user',
      content:
        `The debate is over. Based on everything you've argued and revised, present your definitive Final Answer to the question. Be complete and clear.`,
    },
  ];
}

export function runGCN(
  session: GCNSession,
  question: string,
  config: {
    maxIterations?: number;
    maxTokens?: number;
    temperature?: number;
    convergenceThreshold?: number;
  } = {},
) {
  const maxIterations = Math.min(Math.max(config.maxIterations ?? 4, 0), 10);
  const maxTokens = Math.min(Math.max(config.maxTokens ?? 1024, 128), 4096);
  const temperature = Math.min(Math.max(config.temperature ?? 0.9, 0), 2);
  const convergenceThreshold = config.convergenceThreshold ?? CONVERGENCE_THRESHOLD;

  const signal = session.abortController.signal;
  const anthropicKey = session.keys.anthropic;
  const openaiKey = session.keys.openai;

  return Try(async () => {
    // Round 0: independent first pass
    pushEvent(session, 'left', { type: 'round_start', iteration: 0 });
    pushEvent(session, 'right', { type: 'round_start', iteration: 0 });

    const [leftAnswer, rightAnswer] = await Promise.all([
      leftChatStream(
        {
          model: MODELS.left,
          messages: [{ role: 'system', content: SYSTEM_LEFT }, ...initialMessages(question)],
          maxTokens,
          temperature,
          apiKey: anthropicKey,
          signal,
        },
        (token) => pushEvent(session, 'left', { type: 'token', content: token }),
      ),
      rightChatStream(
        {
          model: MODELS.right,
          messages: [{ role: 'system', content: SYSTEM_RIGHT }, ...initialMessages(question)],
          maxTokens,
          temperature,
          apiKey: openaiKey,
          signal,
        },
        (token) => pushEvent(session, 'right', { type: 'token', content: token }),
      ),
    ]);

    pushEvent(session, 'left', { type: 'round_end', iteration: 0 });
    pushEvent(session, 'right', { type: 'round_end', iteration: 0 });

    let currentLeft = leftAnswer;
    let currentRight = rightAnswer;
    let lastScore = 0;
    let stagnantRounds = 0;
    let converged = false;

    // Convergence check between round 0 and round 1
    {
      const check = await hypervisorChat({
        model: MODELS.hypervisor,
        messages: [
          { role: 'system', content: SYSTEM_HYPERVISOR },
          { role: 'user', content: `Answer A:\n${currentLeft}\n\nAnswer B:\n${currentRight}` },
        ],
        maxTokens: 512,
        temperature: 0,
        apiKey: openaiKey,
        signal,
      });
      if (check.success) {
        const cleaned = check.data.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        const match = cleaned.match(/\d+\.\d+|\d+/);
        const score = match ? parseFloat(match[0]) : NaN;
        if (!isNaN(score) && score >= 0 && score <= 1) {
          lastScore = score;
          pushEvent(session, 'hypervisor', { type: 'convergence', score });
          if (score >= convergenceThreshold) converged = true;
        }
      }
    }

    for (let i = 1; !converged && i <= maxIterations; i++) {
      // Each model rewrites the other's answer from its own perspective
      pushEvent(session, 'left', { type: 'round_start', iteration: i });
      pushEvent(session, 'right', { type: 'round_start', iteration: i });

      const [rewriteOfRight, rewriteOfLeft] = await Promise.all([
        leftChatStream(
          {
            model: MODELS.left,
            messages: [
              { role: 'system', content: SYSTEM_LEFT },
              ...rewriteMessages(question, currentRight),
            ],
            maxTokens,
            temperature,
            apiKey: anthropicKey,
            signal,
          },
          (token) => pushEvent(session, 'left', { type: 'token', content: token }),
        ),
        rightChatStream(
          {
            model: MODELS.right,
            messages: [
              { role: 'system', content: SYSTEM_RIGHT },
              ...rewriteMessages(question, currentLeft),
            ],
            maxTokens,
            temperature,
            apiKey: openaiKey,
            signal,
          },
          (token) => pushEvent(session, 'right', { type: 'token', content: token }),
        ),
      ]);

      pushEvent(session, 'left', { type: 'round_end', iteration: i });
      pushEvent(session, 'right', { type: 'round_end', iteration: i });

      // Swap: each panel now shows the other model's rewrite of its previous answer
      currentLeft = rewriteOfRight;
      currentRight = rewriteOfLeft;

      // Neutral lightweight convergence check
      const check = await hypervisorChat({
        model: MODELS.hypervisor,
        messages: [
          { role: 'system', content: SYSTEM_HYPERVISOR },
          {
            role: 'user',
            content: `Answer A:\n${currentLeft}\n\nAnswer B:\n${currentRight}`,
          },
        ],
        maxTokens: 512,
        temperature: 0,
        apiKey: openaiKey,
        signal,
      });

      if (!check.success) throw new Error(`Hypervisor API failure: ${check.error.message}`);

      // Strip <think>...</think> blocks, then find the first decimal in the response
      const cleaned = check.data.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const match = cleaned.match(/\d+\.\d+|\d+/);
      const score = match ? parseFloat(match[0]) : NaN;
      const validScore = !isNaN(score) && score >= 0 && score <= 1 ? score : null;

      if (validScore === null) break; // garbage response — abort loop, still synthesize

      pushEvent(session, 'hypervisor', { type: 'convergence', score: validScore });

      if (validScore >= convergenceThreshold) {
        converged = true;
        break;
      }

      if (validScore <= lastScore) {
        stagnantRounds++;
        if (stagnantRounds >= STAGNATION_PATIENCE) break;
      } else {
        stagnantRounds = 0;
      }

      lastScore = validScore;
    }

    // Final answer pass — each model presents their definitive answer after the debate
    pushEvent(session, 'left', { type: 'round_start', iteration: -1 });
    pushEvent(session, 'right', { type: 'round_start', iteration: -1 });

    const [finalLeft, finalRight] = await Promise.all([
      leftChatStream(
        {
          model: MODELS.left,
          messages: [
            { role: 'system', content: SYSTEM_LEFT },
            ...finalAnswerMessages(question, currentLeft),
          ],
          maxTokens,
          temperature: 0.3,
          apiKey: anthropicKey,
          signal,
        },
        (token) => pushEvent(session, 'left', { type: 'token', content: token }),
      ),
      rightChatStream(
        {
          model: MODELS.right,
          messages: [
            { role: 'system', content: SYSTEM_RIGHT },
            ...finalAnswerMessages(question, currentRight),
          ],
          maxTokens,
          temperature: 0.3,
          apiKey: openaiKey,
          signal,
        },
        (token) => pushEvent(session, 'right', { type: 'token', content: token }),
      ),
    ]);

    pushEvent(session, 'left', { type: 'round_end', iteration: -1 });
    pushEvent(session, 'right', { type: 'round_end', iteration: -1 });

    // Hypervisor final pass
    pushEvent(session, 'hypervisor', { type: 'round_start', iteration: 0 });
    await hypervisorChatStream(
      {
        model: MODELS.hypervisor,
        messages: [
          { role: 'system', content: SYSTEM_HYPERVISOR_FINAL },
          {
            role: 'user',
            content:
              `Question: ${question}\n\nAnswer A:\n${finalLeft}\n\nAnswer B:\n${finalRight}\n\nPresent the unified best answer.`,
          },
        ],
        maxTokens,
        temperature: 0.3,
        apiKey: openaiKey,
        signal,
      },
      (token) => pushEvent(session, 'hypervisor', { type: 'token', content: token }),
    );
    pushEvent(session, 'hypervisor', { type: 'round_end', iteration: 0 });
    pushEvent(session, 'hypervisor', { type: 'done' });
    pushEvent(session, 'left', { type: 'done' });
    pushEvent(session, 'right', { type: 'done' });
  });
}
