import { useEffect, useRef, useState } from 'react'
import './App.css'

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

function ChatPanel({ title, state }: { title: string; state: PanelState }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.rounds])

  return (
    <div className='chat-panel'>
      <div className='panel-header'>{title}</div>
      <div className='panel-body'>
        {state.rounds.map((round, i) => (
          <div key={i} className='round'>
            <div className='round-label'>
              {round.iteration === 0
                ? 'Initial'
                : round.phase === 'critique'
                ? `Round ${round.iteration} — Critique`
                : `Round ${round.iteration} — Revision`}
            </div>
            <div className='round-content'>
              {round.content}
              {!round.complete && <span className='cursor'>▊</span>}
            </div>
          </div>
        ))}
        {state.error && <div className='error'>{state.error}</div>}
        <div ref={bottomRef} />
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
      body: JSON.stringify({ question, maxIterations: 2, maxTokensPerTurn: 512 }),
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
    <div className='app'>
      <div className='header'>
        <h1>GCN</h1>
        <p className='subtitle'>Generative Cooperative Network</p>
      </div>
      <div className='input-row'>
        <input
          className='question-input'
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder='Ask a question...'
          disabled={loading}
        />
        <button type='button' onClick={handleSubmit} disabled={loading || !question.trim()}>
          {loading ? '...' : 'Ask'}
        </button>
      </div>
      <div className='panels'>
        <ChatPanel title='Left Brain — Analytical' state={left} />
        <ChatPanel title='Right Brain — Abstract' state={right} />
      </div>
      {finalAnswer && (
        <div className='final-answer'>
          <div className='final-label'>Final Answer</div>
          <div className='final-content'>{finalAnswer}</div>
        </div>
      )}
    </div>
  )
}
