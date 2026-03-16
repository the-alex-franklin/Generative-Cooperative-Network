import { chat, chatStream, type Message } from './fireworks.ts'
import { type GCNSession, pushEvent } from './session.ts'

export const MODELS = {
  left: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
  right: 'accounts/fireworks/models/qwen2p5-72b-instruct',
  judge: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
} as const

export type GCNConfig = {
  maxIterations?: number
  maxTokensPerTurn?: number
  temperature?: number
}

const PROCESS_BRIEF =
  `You are one of two independent thinkers collaborating to reach the best possible answer to a question. The process works as follows:
- Round 0: You each generate an independent answer without seeing the other's work.
- Each subsequent round: You receive your previous answer alongside your counterpart's answer. You critique their reasoning, then revise your own answer — incorporating any valid insights while staying true to your perspective.
- The goal is not to agree for agreement's sake, but to genuinely improve your answer through honest critique and open-minded revision.`

const SYSTEM_LEFT = `${PROCESS_BRIEF}

Your role is the analytical thinker. You reason from first principles, decompose problems into structured components, and prioritize logical consistency, precision, and rigor. Maintain this perspective even as you incorporate genuine insights from your counterpart.`

const SYSTEM_RIGHT = `${PROCESS_BRIEF}

Your role is the abstract thinker. You draw connections across domains, reason by analogy, surface non-obvious angles, and reframe problems creatively. Maintain this perspective even as you incorporate genuine insights from your counterpart.`

const SYSTEM_JUDGE =
  `You determine whether two answers have substantively converged — meaning they are making the same core points, even if worded differently. Reply with only "yes" or "no".`

const SYSTEM_SYNTHESIZER =
  `You are a neutral synthesizer. Given two answers to the same question — one from an analytical perspective and one from an abstract perspective — produce a single best answer that integrates their strongest points and resolves any contradictions. Be thorough but concise.`

function initialMessages(question: string): Message[] {
  return [{ role: 'user', content: question }]
}

function critiqueMessages(question: string, counterpartAnswer: string): Message[] {
  return [
    {
      role: 'user',
      content:
        `The question is: ${question}\n\nYour counterpart has provided the following answer:\n\n---\n${counterpartAnswer}\n---\n\nCritique this answer thoroughly. Identify weaknesses, gaps in reasoning, blind spots, and suggest specific improvements. Be honest and rigorous.`,
    },
  ]
}

function revisionMessages(
  question: string,
  ownAnswer: string,
  critiqueOfOwnWork: string,
): Message[] {
  return [
    { role: 'user', content: question },
    { role: 'assistant', content: ownAnswer },
    {
      role: 'user',
      content:
        `Your counterpart has reviewed your answer and provided the following critique and suggestions:\n\n---\n${critiqueOfOwnWork}\n---\n\nRevise your answer, thoughtfully incorporating the valid points from this feedback while staying true to your perspective. Return only your revised answer.`,
    },
  ]
}

export async function runGCN(session: GCNSession, question: string, config: GCNConfig = {}) {
  const maxIterations = config.maxIterations ?? 3
  const maxTokens = config.maxTokensPerTurn ?? 1024
  const temperature = config.temperature ?? 0.7

  try {
    // Round 0: independent first pass
    pushEvent(session, 'left', { type: 'round_start', iteration: 0 })
    pushEvent(session, 'right', { type: 'round_start', iteration: 0 })

    const [leftAnswer, rightAnswer] = await Promise.all([
      chatStream(
        {
          model: MODELS.left,
          messages: [{ role: 'system', content: SYSTEM_LEFT }, ...initialMessages(question)],
          maxTokens,
          temperature,
        },
        (token) => pushEvent(session, 'left', { type: 'token', content: token }),
      ),
      chatStream(
        {
          model: MODELS.right,
          messages: [{ role: 'system', content: SYSTEM_RIGHT }, ...initialMessages(question)],
          maxTokens,
          temperature,
        },
        (token) => pushEvent(session, 'right', { type: 'token', content: token }),
      ),
    ])

    pushEvent(session, 'left', { type: 'round_end', iteration: 0 })
    pushEvent(session, 'right', { type: 'round_end', iteration: 0 })

    let currentLeft = leftAnswer
    let currentRight = rightAnswer

    for (let i = 1; i <= maxIterations; i++) {
      // Phase 1: each model critiques the other's answer in parallel
      pushEvent(session, 'left', { type: 'round_start', iteration: i, phase: 'critique' })
      pushEvent(session, 'right', { type: 'round_start', iteration: i, phase: 'critique' })

      const [critiqueOfRight, critiqueOfLeft] = await Promise.all([
        chatStream(
          {
            model: MODELS.left,
            messages: [
              { role: 'system', content: SYSTEM_LEFT },
              ...critiqueMessages(question, currentRight),
            ],
            maxTokens,
            temperature,
          },
          (token) => pushEvent(session, 'left', { type: 'token', content: token }),
        ),
        chatStream(
          {
            model: MODELS.right,
            messages: [
              { role: 'system', content: SYSTEM_RIGHT },
              ...critiqueMessages(question, currentLeft),
            ],
            maxTokens,
            temperature,
          },
          (token) => pushEvent(session, 'right', { type: 'token', content: token }),
        ),
      ])

      pushEvent(session, 'left', { type: 'round_end', iteration: i, phase: 'critique' })
      pushEvent(session, 'right', { type: 'round_end', iteration: i, phase: 'critique' })

      // Phase 2: each model revises its own answer using the critique it received
      pushEvent(session, 'left', { type: 'round_start', iteration: i, phase: 'revision' })
      pushEvent(session, 'right', { type: 'round_start', iteration: i, phase: 'revision' })

      const [newLeft, newRight] = await Promise.all([
        chatStream(
          {
            model: MODELS.left,
            messages: [
              { role: 'system', content: SYSTEM_LEFT },
              ...revisionMessages(question, currentLeft, critiqueOfLeft),
            ],
            maxTokens,
            temperature,
          },
          (token) => pushEvent(session, 'left', { type: 'token', content: token }),
        ),
        chatStream(
          {
            model: MODELS.right,
            messages: [
              { role: 'system', content: SYSTEM_RIGHT },
              ...revisionMessages(question, currentRight, critiqueOfRight),
            ],
            maxTokens,
            temperature,
          },
          (token) => pushEvent(session, 'right', { type: 'token', content: token }),
        ),
      ])

      pushEvent(session, 'left', { type: 'round_end', iteration: i, phase: 'revision' })
      pushEvent(session, 'right', { type: 'round_end', iteration: i, phase: 'revision' })

      currentLeft = newLeft
      currentRight = newRight

      // Neutral lightweight convergence check — neither left nor right
      const check = await chat({
        model: MODELS.judge,
        messages: [
          { role: 'system', content: SYSTEM_JUDGE },
          {
            role: 'user',
            content: `Answer A:\n${currentLeft}\n\nAnswer B:\n${currentRight}`,
          },
        ],
        maxTokens: 10,
        temperature: 0,
      })

      if (check.success && check.data.trim().toLowerCase().startsWith('yes')) break
    }

    // Synthesize using left-brain model
    const synthResult = await chat({
      model: MODELS.left,
      messages: [
        { role: 'system', content: SYSTEM_SYNTHESIZER },
        {
          role: 'user',
          content:
            `Question: ${question}\n\nAnalytical perspective:\n${currentLeft}\n\nAbstract perspective:\n${currentRight}\n\nSynthesize a single best answer.`,
        },
      ],
      maxTokens,
      temperature: 0.3,
    })

    const finalAnswer = synthResult.success ? synthResult.data : 'Synthesis failed.'
    pushEvent(session, 'left', { type: 'done', content: finalAnswer })
    pushEvent(session, 'right', { type: 'done', content: finalAnswer })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    pushEvent(session, 'left', { type: 'error', message })
    pushEvent(session, 'right', { type: 'error', message })
  }
}
