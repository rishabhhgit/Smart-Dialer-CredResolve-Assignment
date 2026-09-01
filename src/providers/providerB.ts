import {
  TelecomProvider,
  OutboundCallRequest,
  ProviderCallEvent,
  ProviderEventCallback,
  ProviderMetrics,
} from "./types";

export interface ProviderBConfig {
  failureRate: number;
  timeoutRate: number;
  duplicateRate: number;
  outOfOrderRate: number;
  baseLatency: number;
}

const DEFAULT_CONFIG: ProviderBConfig = {
  failureRate: 0.15,
  timeoutRate: 0.1,
  duplicateRate: 0.1,
  outOfOrderRate: 0.15,
  baseLatency: 200,
};

export class ProviderB implements TelecomProvider {
  readonly name = "ProviderB";
  private eventCallbacks: ProviderEventCallback[] = [];
  private callCounter = 0;
  private healthy = true;
  private metrics: ProviderMetrics = {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    avgLatency: 200,
    isHealthy: true,
  };
  private config: ProviderBConfig;

  constructor(config: Partial<ProviderBConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get isHealthy(): boolean {
    return this.healthy;
  }

  async initiateCall(request: OutboundCallRequest): Promise<{ providerCallId: string }> {
    this.metrics.totalCalls++;
    this.callCounter++;
    const providerCallId = `PB_${this.callCounter}`;

    const latency = this.config.baseLatency + Math.random() * 300;

    setTimeout(() => {
      this.emitEvent({
        providerCallId,
        callId: request.callId,
        status: "RINGING",
        timestamp: Date.now(),
      });
    }, latency);

    const answerDelay = 2000 + Math.random() * 4000;
    setTimeout(() => {
      const answers = Math.random() > this.config.failureRate;
      const timesOut = Math.random() < this.config.timeoutRate;

      const event: ProviderCallEvent = {
        providerCallId,
        callId: request.callId,
        status: timesOut ? "TIMEOUT" : answers ? "ANSWERED" : "FAILED",
        timestamp: Date.now(),
        reason: timesOut ? "TIMEOUT" : answers ? undefined : "NO_ANSWER",
      };

      this.emitEvent(event);

      if (Math.random() < this.config.duplicateRate) {
        setTimeout(() => {
          this.emitEvent({ ...event, timestamp: Date.now() });
        }, 100 + Math.random() * 200);
      }
    }, latency + answerDelay);

    if (Math.random() < this.config.outOfOrderRate) {
      const event: ProviderCallEvent = {
        providerCallId,
        callId: request.callId,
        status: "FAILED",
        timestamp: Date.now(),
        reason: "PROVIDER_ERROR",
      };
      setTimeout(() => {
        this.emitEvent(event);
      }, latency + answerDelay + 5000 + Math.random() * 10000);
    }

    if (Math.random() > this.config.failureRate) {
      const duration = 5000 + Math.random() * 20000;
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

  setConfig(config: Partial<ProviderBConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
