/**
 * An app-wide event log: a bounded list of things that happened, from any
 * source. The Event log panel shows it; anything in the app may write to it.
 */
export interface AppEvent {
  seq: number;
  time: number;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
}

const MAX = 1000;
let events: AppEvent[] = [];
let seq = 0;
const listeners = new Set<() => void>();

export const eventLog = {
  getAll: () => events,
  subscribe: (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn)),
  push(level: AppEvent["level"], source: string, message: string) {
    events = [...events, { seq: ++seq, time: Date.now(), level, source, message }].slice(-MAX);
    listeners.forEach((fn) => fn());
  },
  clear() {
    events = [];
    listeners.forEach((fn) => fn());
  },
};
