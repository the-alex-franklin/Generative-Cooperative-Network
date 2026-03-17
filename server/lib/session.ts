export type StreamEventType =
  | 'token'
  | 'round_start'
  | 'round_end'
  | 'done'
  | 'error'
  | 'convergence';

export type StreamEvent = {
  type: StreamEventType;
  content?: string;
  iteration?: number;
  score?: number;
  message?: string;
};

type Subscriber = (event: StreamEvent) => void;

interface SideChannel {
  buffer: StreamEvent[];
  subscribers: Set<Subscriber>;
}

export type GCNSession = {
  id: string;
  abortController: AbortController;
  keys: { anthropic?: string; openai?: string };
  sides: {
    left: SideChannel;
    right: SideChannel;
    hypervisor: SideChannel;
  };
};

const sessions = new Map<string, GCNSession>();

export function createSession(
  id: string,
  keys: { anthropic?: string; openai?: string } = {},
): GCNSession {
  const session: GCNSession = {
    id,
    abortController: new AbortController(),
    keys,
    sides: {
      left: { buffer: [], subscribers: new Set() },
      right: { buffer: [], subscribers: new Set() },
      hypervisor: { buffer: [], subscribers: new Set() },
    },
  };
  sessions.set(id, session);
  // auto-cleanup after 10 minutes
  setTimeout(() => sessions.delete(id), 10 * 60 * 1000);
  return session;
}

export function getSession(id: string): GCNSession | undefined {
  return sessions.get(id);
}

export function abortSession(session: GCNSession) {
  session.abortController.abort();
}

export function pushEvent(
  session: GCNSession,
  side: 'left' | 'right' | 'hypervisor',
  event: StreamEvent,
) {
  const channel = session.sides[side];
  channel.buffer.push(event);
  for (const sub of channel.subscribers) {
    sub(event);
  }
}

export function subscribe(
  session: GCNSession,
  side: 'left' | 'right' | 'hypervisor',
  onEvent: Subscriber,
): () => void {
  const channel = session.sides[side];
  // replay buffered events so late subscribers catch up
  for (const event of channel.buffer) {
    onEvent(event);
  }
  channel.subscribers.add(onEvent);
  return () => channel.subscribers.delete(onEvent);
}
