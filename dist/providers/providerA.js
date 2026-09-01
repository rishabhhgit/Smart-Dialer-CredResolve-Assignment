"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderA = void 0;
class ProviderA {
    name = "ProviderA";
    eventCallbacks = [];
    callCounter = 0;
    healthy = true;
    metrics = {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        avgLatency: 50,
        isHealthy: true,
    };
    get isHealthy() {
        return this.healthy;
    }
    async initiateCall(request) {
        this.metrics.totalCalls++;
        this.callCounter++;
        const providerCallId = `PA_${this.callCounter}`;
        // Simulate fast connection with low latency
        const latency = 50 + Math.random() * 100;
        setTimeout(() => {
            this.emitEvent({
                providerCallId,
                callId: request.callId,
                status: "RINGING",
                timestamp: Date.now(),
            });
        }, latency);
        // Simulate answer after 1-3 seconds (fast provider)
        const answerDelay = 1000 + Math.random() * 2000;
        setTimeout(() => {
            const answers = Math.random() < 0.85; // 85% answer rate
            this.emitEvent({
                providerCallId,
                callId: request.callId,
                status: answers ? "ANSWERED" : "FAILED",
                timestamp: Date.now(),
                reason: answers ? undefined : "NO_ANSWER",
            });
        }, latency + answerDelay);
        // Simulate call completion after 60-180 seconds if answered
        if (Math.random() < 0.85) {
            const duration = 60000 + Math.random() * 120000;
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
        // Provider A handles hangups cleanly
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
}
exports.ProviderA = ProviderA;
//# sourceMappingURL=providerA.js.map