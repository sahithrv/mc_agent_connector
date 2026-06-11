import type { StudioEventEnvelope, StudioEventMap, StudioEventName } from "./types";

type Listener<K extends StudioEventName> = (payload: StudioEventMap[K]) => void;
type StoredListener = (payload: unknown) => void;
type AnyListener = (event: StudioEventEnvelope) => void;

export class StudioEventBus {
  private readonly listeners = new Map<StudioEventName, Set<StoredListener>>();
  private readonly anyListeners = new Set<AnyListener>();

  subscribe<K extends StudioEventName>(type: K, listener: Listener<K>): () => void {
    const listeners = this.listeners.get(type) ?? new Set<StoredListener>();
    const stored: StoredListener = (payload) => listener(payload as StudioEventMap[K]);
    listeners.add(stored);
    this.listeners.set(type, listeners);
    return () => listeners.delete(stored);
  }

  subscribeAll(listener: AnyListener): () => void {
    this.anyListeners.add(listener);
    return () => this.anyListeners.delete(listener);
  }

  emit<K extends StudioEventName>(type: K, payload: StudioEventMap[K]): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(payload);
    }

    const event = { type, payload } as StudioEventEnvelope<K>;
    for (const listener of this.anyListeners) {
      listener(event as StudioEventEnvelope);
    }
  }
}
