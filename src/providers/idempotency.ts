import { ProviderCallEvent } from "../providers/types";

export interface IdempotencyEntry {
  eventKey: string;
  processedAt: number;
  result: "accepted" | "rejected" | "duplicate";
}

export class IdempotencyManager {
  private processedEvents: Map<string, IdempotencyEntry> = new Map();
  private readonly WINDOW_MS = 5000;
  private readonly CLEANUP_INTERVAL = 10000;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanup();
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.processedEvents) {
      if (now - entry.processedAt > this.WINDOW_MS * 2) {
        this.processedEvents.delete(key);
      }
    }
  }

  generateEventKey(event: ProviderCallEvent): string {
    return `${event.callId}_${event.status}_${event.providerCallId}`;
  }

  isDuplicate(event: ProviderCallEvent): boolean {
    const key = this.generateEventKey(event);
    const existing = this.processedEvents.get(key);

    if (!existing) return false;

    const timeDiff = Math.abs(event.timestamp - existing.processedAt);
    return timeDiff < this.WINDOW_MS;
  }

  markProcessed(
    event: ProviderCallEvent,
    result: "accepted" | "rejected" | "duplicate"
  ): void {
    const key = this.generateEventKey(event);
    this.processedEvents.set(key, {
      eventKey: key,
      processedAt: Date.now(),
      result,
    });
  }

  getProcessedCount(): number {
    return this.processedEvents.size;
  }

  getDuplicateCount(): number {
    return Array.from(this.processedEvents.values()).filter(
      (e) => e.result === "duplicate"
    ).length;
  }

  wasProcessedWithinWindow(event: ProviderCallEvent, windowMs: number): boolean {
    const key = this.generateEventKey(event);
    const existing = this.processedEvents.get(key);

    if (!existing) return false;

    const timeDiff = Math.abs(event.timestamp - existing.processedAt);
    return timeDiff < windowMs;
  }
}
