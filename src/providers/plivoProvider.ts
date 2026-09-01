import {
  TelecomProvider,
  OutboundCallRequest,
  ProviderCallEvent,
  ProviderEventCallback,
  ProviderMetrics,
} from "./types";

export interface PlivoConfig {
  authId: string;
  authToken: string;
  fromNumber: string;
  answerUrl?: string;
  hangupUrl?: string;
}

export class PlivoProvider implements TelecomProvider {
  readonly name = "Plivo";
  private eventCallbacks: ProviderEventCallback[] = [];
  private callCounter = 0;
  private healthy = true;
  private config: PlivoConfig;
  private activeCalls: Map<string, { callId: string; startTime: number }> = new Map();
  private metrics: ProviderMetrics = {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    avgLatency: 200,
    isHealthy: true,
  };

  constructor(config: PlivoConfig) {
    this.config = config;
  }

  get isHealthy(): boolean {
    return this.healthy;
  }

  async initiateCall(request: OutboundCallRequest): Promise<{ providerCallId: string }> {
    this.metrics.totalCalls++;
    this.callCounter++;
    const providerCallId = `PLIVO_${this.callCounter}`;

    const payload = {
      src: this.config.fromNumber,
      dst: request.phoneNumber,
      answer_url: this.config.answerUrl || "https://webhook.example.com/answer",
      hangup_url: this.config.hangupUrl || "https://webhook.example.com/hangup",
      call_uuid: providerCallId,
    };

    console.log(`[Plivo] Initiating call: ${JSON.stringify(payload)}`);

    this.activeCalls.set(providerCallId, {
      callId: request.callId,
      startTime: Date.now(),
    });

    setTimeout(() => {
      this.emitEvent({
        providerCallId,
        callId: request.callId,
        status: "RINGING",
        timestamp: Date.now(),
      });
    }, 100);

    const answerDelay = 1500 + Math.random() * 3000;
    setTimeout(() => {
      const answers = Math.random() < 0.85;
      if (answers) {
        this.emitEvent({
          providerCallId,
          callId: request.callId,
          status: "ANSWERED",
          timestamp: Date.now(),
        });

        const duration = 10000 + Math.random() * 60000;
        setTimeout(() => {
          this.emitEvent({
            providerCallId,
            callId: request.callId,
            status: "COMPLETED",
            timestamp: Date.now(),
            duration,
          });
          this.activeCalls.delete(providerCallId);
          this.metrics.successfulCalls++;
        }, duration);
      } else {
        this.emitEvent({
          providerCallId,
          callId: request.callId,
          status: "FAILED",
          timestamp: Date.now(),
          reason: "NO_ANSWER",
        });
        this.activeCalls.delete(providerCallId);
        this.metrics.failedCalls++;
      }
    }, answerDelay);

    return { providerCallId };
  }

  async hangupCall(providerCallId: string): Promise<void> {
    console.log(`[Plivo] Hanging up call: ${providerCallId}`);
    this.activeCalls.delete(providerCallId);
  }

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

  getConfig(): PlivoConfig {
    return { ...this.config };
  }
}
