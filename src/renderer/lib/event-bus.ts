export type EventMap = {
  "play-file": { filePath: string };
  "refresh-panel": { panelId: "left" | "right" };
};

type Handler<T> = (data: T) => void;

class EventBus {
  private handlers = new Map<string, Set<Handler<never>>>();

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as Handler<never>);
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.handlers.get(event)?.forEach((h) => (h as Handler<EventMap[K]>)(data));
  }
}

export const eventBus = new EventBus();
