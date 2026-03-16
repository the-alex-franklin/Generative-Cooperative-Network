import { chat, chatStream, type Message } from './fireworks.ts'
import { type GCNSession, pushEvent } from './session.ts'
import { Try } from '../../src/utils/functions/try.ts'

export const MODELS = {
  left: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
  right: 'accounts/fireworks/models/qwen2p5-72b-instruct',
  judge: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
} as const

const PROCESS_BRIEF =
  `You are one of two independent thinkers collaborating to reach the best possible answer to a question. The process works as follows:
- Round 0: You each generate an independent answer without seeing the other's work.
- Each subsequent round has two phases:
  Phase 1 (Critique): You are shown your counterpart's answer and asked to critique it — identify weaknesses, gaps, or errors in their reasoning.
  Phase 2 (Revision): You are shown your own previous answer along with your counterpart's critique of it. Revise your answer, incorporating any valid feedback while staying true to your perspective.
- The goal is not to agree for agreement's sake, but to genuinely improve your answer through honest critique and open-minded revision.
- Be concise and dense. Prioritize signal over length. Do not pad, repeat yourself, or restate things that don't need restating.`

const SYSTEM_LEFT = `${PROCESS_BRIEF}

Your role is the analytical thinker. You reason from first principles, decompose problems into structured components, and prioritize logical consistency, precision, and rigor. Maintain this perspective even as you incorporate genuine insights from your counterpart.`

const SYSTEM_RIGHT = `${PROCESS_BRIEF}

Your role is the abstract thinker. You draw connections across domains, reason by analogy, surface non-obvious angles, and reframe problems creatively. Maintain this perspective even as you incorporate genuine insights from your counterpart.`

const CONVERGENCE_THRESHOLD = 0.80
const STAGNATION_PATIENCE = 2

const SYSTEM_JUDGE =
  `Rate how substantively similar two answers are on a scale from 0.00 to 1.00, where 0.00 means completely different and 1.00 means essentially identical in their core claims. Reply with only a decimal to two places, e.g. 0.73.`

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
        `The question is: ${question}\n\nYour counterpart answered:\n\n---\n${counterpartAnswer}\n---\n\nIdentify the 2–3 most significant weaknesses in this answer. Be specific and direct. Do not summarize the answer back — just identify the problems.`,
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
        `Your counterpart has critiqued your answer:\n\n---\n${critiqueOfOwnWork}\n---\n\nRevise your answer. Focus only on what needs to change and why — do not rewrite parts that are already sound. Return only your revised answer.`,
    },
  ]
}

const CRITIQUE_TOKENS = 300
const REVISION_DECAY = 0.8
const REVISION_FLOOR = 220

export function runGCN(session: GCNSession, question: string) {
  const maxIterations = 6
  const maxTokens = 1024
  const temperature = 0.8

  return Try(async () => {
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
    let lastScore = 0
    let stagnantRounds = 0

    for (let i = 1; i <= maxIterations; i++) {
      const revisionTokens = Math.max(REVISION_FLOOR, Math.round(maxTokens * REVISION_DECAY ** i))

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
            maxTokens: CRITIQUE_TOKENS,
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
            maxTokens: CRITIQUE_TOKENS,
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
            maxTokens: revisionTokens,
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
            maxTokens: revisionTokens,
            temperature,
          },
          (token) => pushEvent(session, 'right', { type: 'token', content: token }),
        ),
      ])

      pushEvent(session, 'left', { type: 'round_end', iteration: i, phase: 'revision' })
      pushEvent(session, 'right', { type: 'round_end', iteration: i, phase: 'revision' })

      currentLeft = newLeft
      currentRight = newRight

      // Neutral lightweight convergence check
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

      if (!check.success) throw new Error(`Judge API failure: ${check.error}`)

      const score = parseFloat(check.data.trim())
      const validScore = !isNaN(score) && score >= 0 && score <= 1 ? score : null

      if (validScore === null) break // garbage response — abort loop, still synthesize

      if (validScore >= CONVERGENCE_THRESHOLD) break

      if (validScore <= lastScore) {
        stagnantRounds++
        if (stagnantRounds >= STAGNATION_PATIENCE) break
      } else {
        stagnantRounds = 0
      }

      lastScore = validScore
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
  })
}
