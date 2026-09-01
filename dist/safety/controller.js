"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SafetyController = void 0;
const events_1 = require("events");
class SafetyController extends events_1.EventEmitter {
    config;
    metrics = {
        totalRequests: 0,
        approved: 0,
        reduced: 0,
        rejected: 0,
        fallbackToProgressive: 0,
    };
    recentEvents = [];
    MAX_ABANDONED_RATE = 0.03; // 3% max abandoned rate
    MAX_FAILED_RATE = 0.2; // 20% max failure rate
    PROGRESSIVE_FALLBACK_THRESHOLD = 0.5;
    enabled = true;
    constructor(config) {
        super();
        this.config = config;
        if (config?.maxAbandonedRate !== undefined) {
            this.MAX_ABANDONED_RATE = config.maxAbandonedRate;
        }
        if (config?.maxFailedRate !== undefined) {
            this.MAX_FAILED_RATE = config.maxFailedRate;
        }
        if (config?.progressiveFallbackThreshold !== undefined) {
            this.PROGRESSIVE_FALLBACK_THRESHOLD = config.progressiveFallbackThreshold;
        }
    }
    evaluatePacing(request, context) {
        this.metrics.totalRequests++;
        if (!this.enabled) {
            return this.recordDecision({ approved: true, allowedCalls: request.requestedCalls });
        }
        // Rule 1: If provider is unhealthy, reject
        const unhealthyProviders = Object.entries(context.providerHealth)
            .filter(([_, healthy]) => !healthy)
            .map(([name]) => name);
        if (unhealthyProviders.length > 0 && context.availableAgents <= 5) {
            return this.recordDecision({
                approved: false,
                reason: `Provider(s) ${unhealthyProviders.join(", ")} unhealthy and limited agents`,
            });
        }
        // Rule 2: Check abandoned call rate
        if (context.totalCallsLast5Min > 0) {
            const connectedRatio = context.connectedCalls / Math.max(context.activeCalls, 1);
            if (connectedRatio < this.PROGRESSIVE_FALLBACK_THRESHOLD) {
                this.metrics.fallbackToProgressive++;
                return this.recordDecision({
                    approved: true,
                    allowedCalls: 1, // Force progressive mode
                });
            }
        }
        // Rule 3: Never exceed available agents
        const maxAllowed = Math.max(0, context.availableAgents - context.activeCalls);
        if (request.requestedCalls > maxAllowed) {
            this.metrics.reduced++;
            return this.recordDecision({
                approved: true,
                allowedCalls: Math.min(request.requestedCalls, maxAllowed),
            });
        }
        // Rule 4: Apply safety margin based on answer rate
        const safetyMargin = this.calculateSafetyMargin(context);
        const adjustedCalls = Math.floor(request.requestedCalls * safetyMargin);
        if (adjustedCalls < request.requestedCalls) {
            this.metrics.reduced++;
            return this.recordDecision({
                approved: true,
                allowedCalls: Math.max(1, adjustedCalls),
            });
        }
        // Rule 5: Check if we're dialing too aggressively given ringing calls
        if (context.ringingCalls > context.availableAgents * 0.5) {
            const reducedCalls = Math.max(1, Math.floor(request.requestedCalls * 0.5));
            this.metrics.reduced++;
            return this.recordDecision({
                approved: true,
                allowedCalls: reducedCalls,
            });
        }
        return this.recordDecision({
            approved: true,
            allowedCalls: request.requestedCalls,
        });
    }
    calculateSafetyMargin(context) {
        let margin = 1.0;
        // Reduce margin if answer rate is low
        if (context.avgAnswerRate < 0.3) {
            margin *= 0.5;
        }
        else if (context.avgAnswerRate < 0.5) {
            margin *= 0.75;
        }
        // Reduce margin if providers are unhealthy
        const healthyCount = Object.values(context.providerHealth).filter(Boolean).length;
        const totalCount = Object.values(context.providerHealth).length;
        if (totalCount > 0) {
            const healthRatio = healthyCount / totalCount;
            if (healthRatio < 0.5) {
                margin *= 0.3;
            }
            else if (healthRatio < 0.8) {
                margin *= 0.7;
            }
        }
        // Reduce margin if we have many active calls relative to agents
        if (context.activeCalls > 0 && context.availableAgents > 0) {
            const utilization = context.activeCalls / (context.availableAgents + context.activeCalls);
            if (utilization > 0.9) {
                margin *= 0.3;
            }
            else if (utilization > 0.7) {
                margin *= 0.6;
            }
        }
        return Math.max(0.1, Math.min(1.0, margin));
    }
    reportEvent(event) {
        this.recentEvents.push(event);
        this.emit("safety:event", event);
    }
    getMetrics() {
        return { ...this.metrics };
    }
    reset() {
        this.metrics = {
            totalRequests: 0,
            approved: 0,
            reduced: 0,
            rejected: 0,
            fallbackToProgressive: 0,
        };
        this.recentEvents = [];
    }
    recordDecision(decision) {
        if (decision.approved) {
            this.metrics.approved++;
        }
        else {
            this.metrics.rejected++;
        }
        this.metrics.lastDecision = decision;
        return decision;
    }
}
exports.SafetyController = SafetyController;
//# sourceMappingURL=controller.js.map