"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderB = void 0;
const DEFAULT_CONFIG = {
    failureRate: 0.15,
    timeoutRate: 0.1,
    duplicateRate: 0.1,
    outOfOrderRate: 0.15,
    baseLatency: 200,
};
class ProviderB {
    name = "ProviderB";
    eventCallbacks = [];
    callCounter = 0;
    healthy = true;
    metrics = {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        avgLatency: 200,
        isHealthy: true,
    };
    config;
    pendingEvents = [];
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    get isHealthy() {
        return this.healthy;
    }
    async initiateCall(request) {
        this.metrics.totalCalls++;
        this.callCounter++;
        const providerCallId = `PB_${this.callCounter}`;
        // Simulate slower provider with variable latency
        const latency = this.config.baseLatency + Math.random() * 300;
        setTimeout(() => {
            this.emitEvent({
                providerCallId,
                callId: request.callId,
                status: "RINGING",
                timestamp: Date.now(),
            });
        }, latency);
        // Simulate answer with higher failure rate
        const answerDelay = 2000 + Math.random() * 4000;
        setTimeout(() => {
            const answers = Math.random() > this.config.failureRate;
            const timesOut = Math.random() < this.config.timeoutRate;
            const event = {
                providerCallId,
                callId: request.callId,
                status: timesOut ? "TIMEOUT" : answers ? "ANSWERED" : "FAILED",
                timestamp: Date.now(),
                reason: timesOut ? "TIMEOUT" : answers ? undefined : "NO_ANSWER",
            };
            this.emitEvent(event);
            // Duplicate events
            if (Math.random() < this.config.duplicateRate) {
                setTimeout(() => {
                    this.emitEvent({ ...event, timestamp: Date.now() });
                }, 100 + Math.random() * 200);
            }
        }, latency + answerDelay);
        // Out-of-order events
        if (Math.random() < this.config.outOfOrderRate) {
            const event = {
                providerCallId,
                callId: request.callId,
                status: "FAILED",
                timestamp: Date.now(),
                reason: "PROVIDER_ERROR",
            };
            // Delay the failure event so it arrives after ANSWERED
            setTimeout(() => {
                this.emitEvent(event);
            }, latency + answerDelay + 5000 + Math.random() * 10000);
        }
        // Simulate call completion if answered
        if (Math.random() > this.config.failureRate) {
            const duration = 30000 + Math.random() * 150000;
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
    async hangupCall(providerCallId) {
        // Provider B may not handle hangups immediately
    }
    onEvent(callback) {
        this.eventCallbacks.push(callback);
    }
    removeEventCallback(callback) {
        this.eventCallbacks = this.eventCallbacks.filter((cb) => cb !== callback);
    }
    emitEvent(event) {
        for (const cb of this.eventCallbacks) {
            cb(event);
        }
    }
    getMetrics() {
        return { ...this.metrics, isHealthy: this.healthy };
    }
    setHealthy(healthy) {
        this.healthy = healthy;
        this.metrics.isHealthy = healthy;
    }
    setConfig(config) {
        this.config = { ...this.config, ...config };
    }
}
exports.ProviderB = ProviderB;
//# sourceMappingURL=providerB.js.map