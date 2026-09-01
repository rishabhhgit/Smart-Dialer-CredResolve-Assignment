import { EventEmitter } from "events";
import { PacingEngine, DialContext, PacingMetrics } from "./types";

export class ProgressiveDialer extends EventEmitter implements PacingEngine {
  readonly name = "progressive";
  private totalDials = 0;
  private totalConnected = 0;

  calculateDialRate(_campaignId: string, context: DialContext): number {
    const availableSlots = context.availableAgents - context.activeCalls;
    const dialRate = Math.max(0, availableSlots);

    this.emit("pacing:calculated", {
      engine: this.name,
      requestedCalls: dialRate,
      availableAgents: context.availableAgents,
      activeCalls: context.activeCalls,
    });

    return dialRate;
  }

  updateMetrics(metrics: PacingMetrics): void {
    this.totalDials = metrics.totalDials;
    this.totalConnected = metrics.totalConnected;
  }

  reset(): void {
    this.totalDials = 0;
    this.totalConnected = 0;
  }
}
