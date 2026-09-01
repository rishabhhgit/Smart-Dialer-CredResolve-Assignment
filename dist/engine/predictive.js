"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PredictiveDialer = void 0;
const events_1 = require("events");
class PredictiveDialer extends events_1.EventEmitter {
    name = "predictive";
    totalDials = 0;
    totalConnected = 0;
    historicalAnswerRate = 0.5;
    historicalCallDuration = 120; // seconds
    movingAverageWindow = [];
    WINDOW_SIZE = 20;
    calculateDialRate(_campaignId, context) {
        // Update running averages
        this.updateAverages(context);
        const availableAgents = context.availableAgents;
        const activeCalls = context.activeCalls;
        const ringingCalls = context.ringingCalls;
        const connectedCalls = context.connectedCalls;
        // Erlang-C inspired calculation
        // We want to predict how many calls we need to initiate
        // to keep agents busy without over-dialing
        // Step 1: Calculate agent utilization
        const utilization = activeCalls / Math.max(availableAgents + activeCalls, 1);
        // Step 2: Calculate expected answer rate
        const answerRate = this.historicalAnswerRate;
        // Step 3: Calculate how many calls need to be in-flight
        // to maintain target utilization
        const targetUtilization = Math.min(0.85, answerRate * 1.2); // Never exceed 85%
        const targetActiveCalls = Math.floor(availableAgents * targetUtilization);
        // Step 4: Determine how many new calls to initiate
        const callsNeeded = Math.max(0, targetActiveCalls - activeCalls);
        // Step 5: Apply safety based on ringing calls
        // Don't ring too many at once
        const maxRinging = Math.max(1, Math.floor(availableAgents * 0.3));
        const ringingCapacity = Math.max(0, maxRinging - ringingCalls);
        // Step 6: Final calculation
        const requestedCalls = Math.min(callsNeeded, ringingCapacity);
        // Step 7: Apply answer rate factor
        // If answer rate is low, we need to dial more to get the same connected calls
        const adjustedCalls = answerRate > 0.1
            ? Math.ceil(requestedCalls / answerRate)
            : requestedCalls;
        this.emit("pacing:calculated", {
            engine: this.name,
            requestedCalls: adjustedCalls,
            availableAgents,
            activeCalls,
            targetUtilization,
            answerRate,
            ringingCalls,
        });
        return adjustedCalls;
    }
    updateAverages(context) {
        if (context.answeredInLastMinute > 0 && context.callsInLastMinute > 0) {
            const currentRate = context.answeredInLastMinute / context.callsInLastMinute;
            this.movingAverageWindow.push(currentRate);
            if (this.movingAverageWindow.length > this.WINDOW_SIZE) {
                this.movingAverageWindow.shift();
            }
            this.historicalAnswerRate =
                this.movingAverageWindow.reduce((a, b) => a + b, 0) /
                    this.movingAverageWindow.length;
        }
        if (context.avgCallDuration > 0) {
            this.historicalCallDuration =
                this.historicalCallDuration * 0.9 + context.avgCallDuration * 0.1;
        }
    }
    updateMetrics(metrics) {
        this.totalDials = metrics.totalDials;
        this.totalConnected = metrics.totalConnected;
    }
    reset() {
        this.totalDials = 0;
        this.totalConnected = 0;
        this.historicalAnswerRate = 0.5;
        this.historicalCallDuration = 120;
        this.movingAverageWindow = [];
    }
    getHistoricalAnswerRate() {
        return this.historicalAnswerRate;
    }
}
exports.PredictiveDialer = PredictiveDialer;
//# sourceMappingURL=predictive.js.map