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
    <div className='flex flex-1 flex-col overflow-hidden rounded-sm border border-[#6b3fa8]'>
      <div className='border-b border-[#6b3fa8] bg-[#3d2075] px-4 py-2 font-mono text-[11px] tracking-[0.08em] text-[#a87fd4] uppercase'>
        {title}
      </div>
      <div ref={bodyRef} className='flex flex-1 flex-col gap-5 overflow-y-auto p-4'>
        {state.rounds.map((round, i) => (
          <div key={i} className='animate-fade-in'>
            <div className='mb-1 font-mono text-[10px] tracking-[0.12em] text-[#9b7fc7] uppercase'>
              {roundLabel(round)}
            </div>
            <div className='font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words text-[#ccc]'>
              {round.content}
              {!round.complete && <span className='animate-blink text-[#a87fd4]'>▊</span>}
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
  const [streaming, setStreaming] = useState(false)
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
    setStreaming(true)
  }

  const handleAbort = async () => {
    if (!sessionId) return
    await fetch(`/api/gcn/abort/${sessionId}`, { method: 'POST' })
    setStreaming(false)
  }

  useEffect(() => {
    if (!sessionId) return

    const leftEs = new EventSource(`/api/gcn/stream/left/${sessionId}`)
    const rightEs = new EventSource(`/api/gcn/stream/right/${sessionId}`)

    const onDone = () => {
      if (!leftEs.CLOSED && !rightEs.CLOSED) return
      setStreaming(false)
    }

    leftEs.onmessage = (e) => {
      const event: StreamEvent = JSON.parse(e.data)
      setLeft((prev) => applyEvent(prev, event))
      if (event.type === 'done') {
        setFinalAnswer((prev) => prev ?? event.content ?? null)
        leftEs.close()
        onDone()
      }
    }

    rightEs.onmessage = (e) => {
      const event: StreamEvent = JSON.parse(e.data)
      setRight((prev) => applyEvent(prev, event))
      if (event.type === 'done') {
        setFinalAnswer((prev) => prev ?? event.content ?? null)
        rightEs.close()
        onDone()
      }
    }

    leftEs.onerror = () => {
      leftEs.close()
      setStreaming(false)
    }
    rightEs.onerror = () => {
      rightEs.close()
      setStreaming(false)
    }

    return () => {
      leftEs.close()
      rightEs.close()
    }
  }, [sessionId])

  return (
    <div className='flex h-screen flex-col bg-[#2d1b5e] p-8 font-mono text-[#e0e0e0]'>
      <div className='mb-8 text-center'>
        <h1 className='text-xl font-normal tracking-[0.3em]'>GCN</h1>
        <p className='mt-2 text-[11px] tracking-[0.15em] text-[#9b7fc7]'>
          Generative Cooperative Network
        </p>
      </div>
      <div className='mb-8 flex min-h-0 flex-1 gap-8'>
        <ChatPanel title='Left Brain — Analytical' state={left} />
        <ChatPanel title='Right Brain — Abstract' state={right} />
      </div>
      {finalAnswer && (
        <div className='animate-fade-in mb-8 max-h-[25vh] overflow-y-auto rounded-sm border border-[#6b3fa8] bg-[#3d2075] p-5'>
          <div className='mb-2 text-[10px] tracking-[0.12em] text-[#a87fd4] uppercase'>
            Final Answer
          </div>
          <div className='text-[13px] leading-relaxed whitespace-pre-wrap text-[#c4b5e0]'>
            {finalAnswer}
          </div>
        </div>
      )}
      <div className='flex items-end gap-4'>
        <textarea
          className='flex-1 resize-none rounded-sm border border-[#6b3fa8] bg-[#3d2075] px-4 py-3 font-mono text-sm text-[#e0e0e0] outline-none transition-colors placeholder:text-[#7a5a9e] focus:border-[#a87fd4] disabled:opacity-40'
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          placeholder='Ask a question...'
          disabled={loading || streaming}
        />
        <button
          type='button'
          onClick={handleSubmit}
          disabled={loading || streaming || !question.trim()}
          className='rounded-sm border border-[#6b3fa8] bg-[#3d2075] px-6 py-3 font-mono text-sm text-[#ccc] tracking-wide transition-colors hover:border-[#a87fd4] hover:text-white disabled:cursor-default disabled:opacity-35'
        >
          {loading ? '...' : 'Ask'}
        </button>
        <button
          type='button'
          onClick={handleAbort}
          disabled={!streaming}
          className='rounded-sm border border-[#8b3a3a] bg-[#3d1515] px-6 py-3 font-mono text-sm text-[#e08080] tracking-wide transition-colors hover:border-[#c05050] hover:text-white disabled:cursor-default disabled:opacity-35'
        >
          Abort
        </button>
      </div>
    </div>
  )
}
