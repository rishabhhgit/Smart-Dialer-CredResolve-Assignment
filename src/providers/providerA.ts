import {
  TelecomProvider,
  OutboundCallRequest,
  ProviderCallEvent,
  ProviderEventCallback,
  ProviderMetrics,
} from "./types";

export class ProviderA implements TelecomProvider {
  readonly name = "ProviderA";
  private eventCallbacks: ProviderEventCallback[] = [];
  private callCounter = 0;
  private healthy = true;
  private metrics: ProviderMetrics = {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    avgLatency: 50,
    isHealthy: true,
  };

  get isHealthy(): boolean {
    return this.healthy;
  }

  async initiateCall(request: OutboundCallRequest): Promise<{ providerCallId: string }> {
    this.metrics.totalCalls++;
    this.callCounter++;
    const providerCallId = `PA_${this.callCounter}`;

    const latency = 50 + Math.random() * 100;

    setTimeout(() => {
      this.emitEvent({
        providerCallId,
        callId: request.callId,
        status: "RINGING",
        timestamp: Date.now(),
      });
    }, latency);

    const answerDelay = 1000 + Math.random() * 2000;
    setTimeout(() => {
      const answers = Math.random() < 0.85;
      this.emitEvent({
        providerCallId,
        callId: request.callId,
        status: answers ? "ANSWERED" : "FAILED",
        timestamp: Date.now(),
        reason: answers ? undefined : "NO_ANSWER",
      });
    }, latency + answerDelay);

    if (Math.random() < 0.85) {
      const duration = 5000 + Math.random() * 15000;
      setTimeout(() => {
        this.emitEvent({
          providerCallId,
          callId: request.callId,
          status: "COMPLETED",
          timestamp: Date.now(),
          duration,
        });
      }, latency + answerDelay + duration);
    }

    return { providerCallId };
  }

  async hangupCall(providerCallId: string): Promise<void> {}

  onEvent(callback: ProviderEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  removeEventCallback(callback: ProviderEventCallback): void {
    this.eventCallbacks = this.eventCallbacks.filter((cb) => cb !== callback);
  }

  private emitEvent(event: ProviderCallEvent): void {
    for (const cb of this.eventCallbacks) {
      cb(event);
    }
  }

  getMetrics(): ProviderMetrics {
    return { ...this.metrics, isHealthy: this.healthy };
  }

  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
    this.metrics.isHealthy = healthy;
  }
}
