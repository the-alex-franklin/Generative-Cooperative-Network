import { useEffect, useRef, useState } from 'react';

type Round = {
  iteration: number;
  content: string;
  complete: boolean;
};

type PanelState = {
  rounds: Round[];
  done: boolean;
  error?: string;
};

type StreamEvent = {
  type: 'token' | 'round_start' | 'round_end' | 'done' | 'error' | 'convergence';
  content?: string;
  iteration?: number;
  score?: number;
  message?: string;
};

const emptyPanel = (): PanelState => ({ rounds: [], done: false });

function applyEvent(prev: PanelState, event: StreamEvent): PanelState {
  switch (event.type) {
    case 'round_start':
      return {
        ...prev,
        rounds: [
          ...prev.rounds,
          {
            iteration: event.iteration!,
            content: '',
            complete: false,
          },
        ],
      };
    case 'token': {
      const rounds = prev.rounds.map((r, i) =>
        i === prev.rounds.length - 1 ? { ...r, content: r.content + (event.content ?? '') } : r
      );
      return { ...prev, rounds };
    }
    case 'round_end': {
      const rounds = prev.rounds.map((r, i) =>
        i === prev.rounds.length - 1 ? { ...r, complete: true } : r
      );
      return { ...prev, rounds };
    }
    case 'done':
      return { ...prev, done: true };
    case 'error':
      return { ...prev, done: true, error: event.message };
    default:
      return prev;
  }
}

function roundLabel(round: Round): string {
  if (round.iteration === -1) return 'Final Answer';
  if (round.iteration === 0) return 'Initial';
  return `Round ${round.iteration} — Rewrite`;
}

function ChatPanel({ title, state }: { title: string; state: PanelState }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const roundCount = state.rounds.length;
  const lastContent = state.rounds.at(-1)?.content ?? '';

  // Smooth scroll when a new round section appears
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [roundCount]);

  // Instant scroll to keep pace with streaming tokens
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastContent]);

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
  );
}

export default function App() {
  const [question, setQuestion] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [maxIterations, setMaxIterations] = useState(4);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [temperature, setTemperature] = useState(0.9);
  const [convergenceThreshold, setConvergenceThreshold] = useState(0.80);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [convergenceScore, setConvergenceScore] = useState<number | null>(null);
  const [left, setLeft] = useState<PanelState>(emptyPanel());
  const [right, setRight] = useState<PanelState>(emptyPanel());
  const [hypervisor, setHypervisor] = useState<PanelState>(emptyPanel());

  const handleSubmit = async () => {
    if (!question.trim() || loading) return;
    setLoading(true);
    setLeft(emptyPanel());
    setRight(emptyPanel());
    setHypervisor(emptyPanel());
    setConvergenceScore(null);
    setSessionId(null);

    const res = await fetch('/api/gcn/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        anthropicKey: anthropicKey || undefined,
        openaiKey: openaiKey || undefined,
        maxIterations,
        maxTokens,
        temperature,
        convergenceThreshold,
      }),
    });
    const { sessionId: sid } = await res.json();
    setSessionId(sid);
    setLoading(false);
    setStreaming(true);
  };

  const handleAbort = async () => {
    if (!sessionId) return;
    await fetch(`/api/gcn/abort/${sessionId}`, { method: 'POST' });
    setStreaming(false);
  };

  useEffect(() => {
    if (!sessionId) return;

    const leftEs = new EventSource(`/api/gcn/stream/left/${sessionId}`);
    const rightEs = new EventSource(`/api/gcn/stream/right/${sessionId}`);
    const hypervisorEs = new EventSource(`/api/gcn/stream/hypervisor/${sessionId}`);

    leftEs.onmessage = (e) => {
      const event: StreamEvent = JSON.parse(e.data);
      setLeft((prev) => applyEvent(prev, event));
      if (event.type === 'done') leftEs.close();
    };

    rightEs.onmessage = (e) => {
      const event: StreamEvent = JSON.parse(e.data);
      setRight((prev) => applyEvent(prev, event));
      if (event.type === 'done') rightEs.close();
    };

    hypervisorEs.onmessage = (e) => {
      const event: StreamEvent = JSON.parse(e.data);
      if (event.type === 'convergence') {
        setConvergenceScore(event.score ?? null);
        return;
      }
      setHypervisor((prev) => applyEvent(prev, event));
      if (event.type === 'done' || event.type === 'error') {
        hypervisorEs.close();
        setStreaming(false);
      }
    };

    leftEs.onerror = () => {
      leftEs.close();
      setStreaming(false);
    };
    rightEs.onerror = () => {
      rightEs.close();
      setStreaming(false);
    };
    hypervisorEs.onerror = () => {
      hypervisorEs.close();
      setStreaming(false);
    };

    return () => {
      leftEs.close();
      rightEs.close();
      hypervisorEs.close();
    };
  }, [sessionId]);

  return (
    <div className='flex h-screen flex-col bg-[#2d1b5e] p-8 font-mono text-[#e0e0e0]'>
      <div className='mb-8 text-center'>
        <h1 className='font-normal text-[32px] tracking-[0.3em]'>GCN</h1>
        <p className='mt-2 text-[24px] tracking-[0.15em] text-[#9b7fc7]'>
          Generative Cooperative Network
        </p>
      </div>
      <div className='mb-4 grid grid-cols-4 gap-4'>
        <label className='flex flex-col gap-1'>
          <span className='font-mono text-[10px] tracking-[0.1em] text-[#7a5a9e] uppercase'>
            Rounds (max)
          </span>
          <input
            type='number'
            min={0}
            max={10}
            step={1}
            className='rounded-sm border border-[#6b3fa8] bg-[#3d2075] px-3 py-2 font-mono text-xs text-[#e0e0e0] outline-none focus:border-[#a87fd4]'
            value={maxIterations}
            onChange={(e) => setMaxIterations(Number(e.target.value))}
          />
        </label>
        <label className='flex flex-col gap-1'>
          <span className='font-mono text-[10px] tracking-[0.1em] text-[#7a5a9e] uppercase'>
            Max Tokens
          </span>
          <input
            type='number'
            min={128}
            max={4096}
            step={128}
            className='rounded-sm border border-[#6b3fa8] bg-[#3d2075] px-3 py-2 font-mono text-xs text-[#e0e0e0] outline-none focus:border-[#a87fd4]'
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value))}
          />
        </label>
        <label className='flex flex-col gap-1'>
          <span className='font-mono text-[10px] tracking-[0.1em] text-[#7a5a9e] uppercase'>
            Temperature
          </span>
          <input
            type='number'
            min={0}
            max={2}
            step={0.05}
            className='rounded-sm border border-[#6b3fa8] bg-[#3d2075] px-3 py-2 font-mono text-xs text-[#e0e0e0] outline-none focus:border-[#a87fd4]'
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
          />
        </label>
        <label className='flex flex-col gap-1'>
          <span className='font-mono text-[10px] tracking-[0.1em] text-[#7a5a9e] uppercase'>
            Conv. Threshold
          </span>
          <input
            type='number'
            min={0}
            max={1}
            step={0.05}
            className='rounded-sm border border-[#6b3fa8] bg-[#3d2075] px-3 py-2 font-mono text-xs text-[#e0e0e0] outline-none focus:border-[#a87fd4]'
            value={convergenceThreshold}
            onChange={(e) => setConvergenceThreshold(Number(e.target.value))}
          />
        </label>
      </div>
      <div className='mb-4 flex gap-4'>
        <input
          type='password'
          className='flex-1 rounded-sm border border-[#6b3fa8] bg-[#3d2075] px-3 py-2 font-mono text-xs text-[#e0e0e0] outline-none placeholder:text-[#7a5a9e] focus:border-[#a87fd4]'
          placeholder='Anthropic API key (sk-ant-...)'
          value={anthropicKey}
          onChange={(e) => setAnthropicKey(e.target.value)}
        />
        <input
          type='password'
          className='flex-1 rounded-sm border border-[#6b3fa8] bg-[#3d2075] px-3 py-2 font-mono text-xs text-[#e0e0e0] outline-none placeholder:text-[#7a5a9e] focus:border-[#a87fd4]'
          placeholder='OpenAI API key (sk-)'
          value={openaiKey}
          onChange={(e) => setOpenaiKey(e.target.value)}
        />
      </div>
      <div className='mb-4 flex min-h-0 flex-1 gap-8'>
        <ChatPanel title='Left Brain — Analytical · claude-haiku-4-5' state={left} />
        <ChatPanel title='Right Brain — Abstract · gpt-4o-mini' state={right} />
      </div>
      <div className='mb-2 flex items-center justify-center gap-3'>
        <div className='h-px flex-1 bg-[#3d2075]' />
        <span className='font-mono tracking-[0.12em] text-[#7a5a9e] uppercase flex items-baseline gap-2'>
          <span className='text-[32px]'>convergence</span>
          <span className='text-[32px] leading-none'>
            {convergenceScore === null ? '—' : `${(convergenceScore * 100).toFixed(0)}%`}
          </span>
        </span>
        <div className='h-px flex-1 bg-[#3d2075]' />
      </div>
      <div className='mb-8 flex h-[28vh] flex-shrink-0 flex-col'>
        <ChatPanel title='Hypervisor · gpt-4o-mini' state={hypervisor} />
      </div>
      <div className='flex items-end gap-4'>
        <textarea
          className='flex-1 resize-none rounded-sm border border-[#6b3fa8] bg-[#3d2075] px-4 py-3 font-mono text-sm text-[#e0e0e0] outline-none transition-colors placeholder:text-[#7a5a9e] focus:border-[#a87fd4] disabled:opacity-40'
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
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
  );
}
