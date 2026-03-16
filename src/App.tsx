import { useEffect, useRef, useState } from 'react'

type Round = {
  iteration: number
  phase: 'initial' | 'critique' | 'revision'
  content: string
  complete: boolean
}

type PanelState = {
  rounds: Round[]
  done: boolean
  error?: string
}

type StreamEvent = {
  type: 'token' | 'round_start' | 'round_end' | 'done' | 'error'
  content?: string
  iteration?: number
  phase?: 'initial' | 'critique' | 'revision'
  message?: string
}

const emptyPanel = (): PanelState => ({ rounds: [], done: false })

function applyEvent(prev: PanelState, event: StreamEvent): PanelState {
  switch (event.type) {
    case 'round_start':
      return {
        ...prev,
        rounds: [
          ...prev.rounds,
          {
            iteration: event.iteration!,
            phase: event.phase ?? 'initial',
            content: '',
            complete: false,
          },
        ],
      }
    case 'token': {
      const rounds = prev.rounds.map((r, i) =>
        i === prev.rounds.length - 1 ? { ...r, content: r.content + (event.content ?? '') } : r
      )
      return { ...prev, rounds }
    }
    case 'round_end': {
      const rounds = prev.rounds.map((r, i) =>
        i === prev.rounds.length - 1 ? { ...r, complete: true } : r
      )
      return { ...prev, rounds }
    }
    case 'done':
      return { ...prev, done: true }
    case 'error':
      return { ...prev, done: true, error: event.message }
    default:
      return prev
  }
}

function roundLabel(round: Round): string {
  if (round.iteration === 0) return 'Initial'
  if (round.phase === 'critique') return `Round ${round.iteration} — Critique`
  return `Round ${round.iteration} — Revision`
}

function ChatPanel({ title, state }: { title: string; state: PanelState }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const roundCount = state.rounds.length
  const lastContent = state.rounds.at(-1)?.content ?? ''

  // Smooth scroll when a new round section appears
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [roundCount])

  // Instant scroll to keep pace with streaming tokens
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastContent])

  return (
    <div className='flex flex-1 flex-col overflow-hidden rounded-sm border border-[#1e1e1e]'>
      <div className='border-b border-[#1e1e1e] bg-[#141414] px-3 py-1.5 font-mono text-[11px] tracking-[0.08em] text-[#666] uppercase'>
        {title}
      </div>
      <div ref={bodyRef} className='flex flex-1 flex-col gap-4 overflow-y-auto p-3'>
        {state.rounds.map((round, i) => (
          <div key={i} className='animate-fade-in'>
            <div className='mb-1 font-mono text-[10px] tracking-[0.12em] text-[#444] uppercase'>
              {roundLabel(round)}
            </div>
            <div className='font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words text-[#ccc]'>
              {round.content}
              {!round.complete && <span className='animate-blink text-[#666]'>▊</span>}
            </div>
          </div>
        ))}
        {state.error && <div className='font-mono text-[13px] text-[#c06060]'>{state.error}</div>}
      </div>
    </div>
  )
}

export default function App() {
  const [question, setQuestion] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [left, setLeft] = useState<PanelState>(emptyPanel())
  const [right, setRight] = useState<PanelState>(emptyPanel())
  const [finalAnswer, setFinalAnswer] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!question.trim() || loading) return
    setLoading(true)
    setLeft(emptyPanel())
    setRight(emptyPanel())
    setFinalAnswer(null)
    setSessionId(null)

    const res = await fetch('/api/gcn/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    })
    const { sessionId: sid } = await res.json()
    setSessionId(sid)
    setLoading(false)
  }

  useEffect(() => {
    if (!sessionId) return

    const leftEs = new EventSource(`/api/gcn/stream/left/${sessionId}`)
    const rightEs = new EventSource(`/api/gcn/stream/right/${sessionId}`)

    leftEs.onmessage = (e) => {
      const event: StreamEvent = JSON.parse(e.data)
      setLeft((prev) => applyEvent(prev, event))
      if (event.type === 'done') {
        setFinalAnswer((prev) => prev ?? event.content ?? null)
        leftEs.close()
      }
    }

    rightEs.onmessage = (e) => {
      const event: StreamEvent = JSON.parse(e.data)
      setRight((prev) => applyEvent(prev, event))
      if (event.type === 'done') {
        setFinalAnswer((prev) => prev ?? event.content ?? null)
        rightEs.close()
      }
    }

    leftEs.onerror = () => leftEs.close()
    rightEs.onerror = () => rightEs.close()

    return () => {
      leftEs.close()
      rightEs.close()
    }
  }, [sessionId])

  return (
    <div className='flex h-screen flex-col gap-3 bg-[#0d0d0d] p-4 font-mono text-[#e0e0e0]'>
      <div className='text-center'>
        <h1 className='text-xl font-normal tracking-[0.3em]'>GCN</h1>
        <p className='mt-1 text-[11px] tracking-[0.15em] text-[#555]'>
          Generative Cooperative Network
        </p>
      </div>
      <div className='flex gap-2'>
        <input
          className='flex-1 rounded-sm border border-[#2a2a2a] bg-[#141414] px-3 py-2 font-mono text-sm text-[#e0e0e0] outline-none transition-colors placeholder:text-[#333] focus:border-[#444] disabled:opacity-40'
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder='Ask a question...'
          disabled={loading}
        />
        <button
          type='button'
          onClick={handleSubmit}
          disabled={loading || !question.trim()}
          className='rounded-sm border border-[#333] bg-[#1a1a1a] px-6 py-2 font-mono text-sm text-[#ccc] tracking-wide transition-colors hover:border-[#555] hover:text-white disabled:cursor-default disabled:opacity-35'
        >
          {loading ? '...' : 'Ask'}
        </button>
      </div>
      <div className='flex min-h-0 flex-1 gap-3'>
        <ChatPanel title='Left Brain — Analytical' state={left} />
        <ChatPanel title='Right Brain — Abstract' state={right} />
      </div>
      {finalAnswer && (
        <div className='animate-fade-in max-h-[30vh] overflow-y-auto rounded-sm border border-[#1e2e1e] bg-[#0c140c] p-3'>
          <div className='mb-1 text-[10px] tracking-[0.12em] text-[#3a6e3a] uppercase'>
            Final Answer
          </div>
          <div className='text-[13px] leading-relaxed whitespace-pre-wrap text-[#aaccaa]'>
            {finalAnswer}
          </div>
        </div>
      )}
    </div>
  )
}
