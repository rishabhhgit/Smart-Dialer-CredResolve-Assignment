"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DialerOrchestrator = void 0;
const events_1 = require("events");
const agent_1 = require("../models/agent");
const call_1 = require("../models/call");
const controller_1 = require("../safety/controller");
const progressive_1 = require("../engine/progressive");
const predictive_1 = require("../engine/predictive");
class DialerOrchestrator extends events_1.EventEmitter {
    agentManager;
    callManager;
    safetyController;
    providers = new Map();
    campaigns = new Map();
    pacingEngines = new Map();
    metrics = new Map();
    pacingIntervals = new Map();
    eventBuffer = new Map();
    workerId;
    constructor(workerId) {
        super();
        this.workerId = workerId || `worker_${Date.now()}`;
        this.agentManager = new agent_1.AgentManager();
        this.callManager = new call_1.CallManager();
        this.safetyController = new controller_1.SafetyController();
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        this.agentManager.on("agent:transition", (data) => {
            this.emit("agent:transition", data);
        });
        this.callManager.on("call:transition", (data) => {
            this.emit("call:transition", data);
        });
    }
    registerProvider(provider) {
        this.providers.set(provider.name, provider);
        provider.onEvent((event) => this.handleProviderEvent(provider.name, event));
    }
    createCampaign(config) {
        const campaign = {
            ...config,
            status: "active",
            createdAt: Date.now(),
        };
        this.campaigns.set(config.id, campaign);
        // Set up pacing engine
        if (config.mode === "progressive") {
            this.pacingEngines.set(config.id, new progressive_1.ProgressiveDialer());
        }
        else {
            this.pacingEngines.set(config.id, new predictive_1.PredictiveDialer());
        }
        // Initialize metrics
        this.metrics.set(config.id, {
            campaignId: config.id,
            totalAgents: 0,
            availableAgents: 0,
            totalCalls: 0,
            activeCalls: 0,
            connectedCalls: 0,
            failedCalls: 0,
            completionRate: 0,
            avgWaitTime: 0,
            utilization: 0,
            pacingDecisions: 0,
            safetyDecisions: 0,
        });
        return campaign;
    }
    addAgent(agentId, campaignId) {
        return this.agentManager.createAgent(agentId, campaignId);
    }
    startPacing(campaignId, intervalMs = 1000) {
        if (this.pacingIntervals.has(campaignId)) {
            return;
        }
        const interval = setInterval(() => {
            this.runPacingCycle(campaignId);
        }, intervalMs);
        this.pacingIntervals.set(campaignId, interval);
    }
    stopPacing(campaignId) {
        const interval = this.pacingIntervals.get(campaignId);
        if (interval) {
            clearInterval(interval);
            this.pacingIntervals.delete(campaignId);
        }
    }
    async runPacingCycle(campaignId) {
        const campaign = this.campaigns.get(campaignId);
        if (!campaign || campaign.status !== "active")
            return;
        const engine = this.pacingEngines.get(campaignId);
        if (!engine)
            return;
        const dialContext = this.getDialContext(campaignId);
        const requestedCalls = engine.calculateDialRate(campaignId, dialContext);
        // Convert to safety context
        const safetyContext = this.getSafetyContext(campaignId, dialContext);
        // Send to safety controller
        const decision = this.safetyController.evaluatePacing({
            campaignId,
            requestedCalls,
            reason: `Pacing cycle for ${engine.name} engine`,
        }, safetyContext);
        if (!decision.approved) {
            this.emit("safety:rejected", { campaignId, requestedCalls, reason: decision.reason });
            return;
        }
        const callsToMake = decision.allowedCalls;
        if (callsToMake <= 0)
            return;
        // Initiate calls
        await this.initiateCalls(campaignId, callsToMake);
    }
    getDialContext(campaignId) {
        const agents = this.agentManager.getAgentsByCampaign(campaignId);
        const available = agents.filter((a) => a.state === agent_1.AgentState.AVAILABLE);
        const active = this.callManager.getActiveCalls(campaignId);
        const connected = this.callManager.getConnectedCalls(campaignId);
        const ringing = this.callManager.getRingingCalls(campaignId);
        const callsInLastMinute = active.filter((c) => Date.now() - c.createdAt < 60000).length;
        const answeredInLastMinute = connected.filter((c) => Date.now() - c.createdAt < 60000).length;
        return {
            availableAgents: available.length,
            activeCalls: active.length,
            connectedCalls: connected.length,
            ringingCalls: ringing.length,
            avgAnswerRate: this.calculateAnswerRate(campaignId),
            avgCallDuration: this.calculateAvgCallDuration(campaignId),
            callsInLastMinute,
            answeredInLastMinute,
        };
    }
    getSafetyContext(campaignId, dialContext) {
        const calls = this.callManager.getCallsByCampaign(campaignId);
        const recentCalls = calls.filter((c) => Date.now() - c.createdAt < 300000); // Last 5 min
        const failedRecent = recentCalls.filter((c) => c.state === call_1.CallState.FAILED).length;
        const providerHealth = {};
        for (const [name, provider] of this.providers) {
            providerHealth[name] = provider.isHealthy;
        }
        return {
            availableAgents: dialContext.availableAgents,
            activeCalls: dialContext.activeCalls,
            connectedCalls: dialContext.connectedCalls,
            ringingCalls: dialContext.ringingCalls,
            failedCallsLast5Min: failedRecent,
            totalCallsLast5Min: recentCalls.length,
            providerHealth,
            avgAnswerRate: dialContext.avgAnswerRate,
            avgCallDuration: dialContext.avgCallDuration,
        };
    }
    calculateAnswerRate(campaignId) {
        const calls = this.callManager.getCallsByCampaign(campaignId);
        const completed = calls.filter((c) => c.state === call_1.CallState.COMPLETED ||
            c.state === call_1.CallState.CONNECTED ||
            c.state === call_1.CallState.FAILED);
        if (completed.length === 0)
            return 0.5; // Default
        const answered = completed.filter((c) => c.state === call_1.CallState.COMPLETED || c.state === call_1.CallState.CONNECTED);
        return answered.length / completed.length;
    }
    calculateAvgCallDuration(campaignId) {
        const calls = this.callManager.getCallsByCampaign(campaignId);
        const completed = calls.filter((c) => c.state === call_1.CallState.COMPLETED);
        if (completed.length === 0)
            return 120; // Default 2 minutes
        const durations = completed
            .map((c) => {
            const history = c.stateHistory;
            const start = history.find((h) => h.state === call_1.CallState.CONNECTED);
            const end = history.find((h) => h.state === call_1.CallState.COMPLETED);
            if (start && end)
                return end.timestamp - start.timestamp;
            return 120000;
        })
            .filter((d) => d > 0);
        return durations.length > 0
            ? durations.reduce((a, b) => a + b, 0) / durations.length / 1000
            : 120;
    }
    async initiateCalls(campaignId, count) {
        const campaign = this.campaigns.get(campaignId);
        if (!campaign)
            return;
        const availableAgents = this.agentManager.getAvailableAgents(campaignId);
        const queuedCalls = this.callManager.getQueuedCalls(campaignId);
        // Create calls if we don't have enough queued
        const callsToCreate = Math.max(0, count - queuedCalls.length);
        for (let i = 0; i < callsToCreate; i++) {
            const borrowerId = this.selectBorrower(campaign);
            if (borrowerId) {
                this.callManager.createCall(campaignId, borrowerId);
            }
        }
        // Get updated queued calls
        const updatedQueued = this.callManager.getQueuedCalls(campaignId);
        // Match calls with agents
        const callsToInitiate = updatedQueued.slice(0, Math.min(count, availableAgents.length));
        for (const call of callsToInitiate) {
            const agent = availableAgents.find((a) => a.state === agent_1.AgentState.AVAILABLE);
            if (!agent)
                break;
            // Reserve agent
            const reservation = await this.agentManager.reserveAgent(agent.id, call.id, this.workerId);
            if (!reservation)
                continue; // Agent was taken by another worker
            // Assign agent to call
            this.callManager.assignAgent(call.id, agent.id);
            // Transition call to RESERVED
            await this.callManager.transitionCall(call.id, call_1.CallState.RESERVED);
            // Transition agent to DIALING
            this.agentManager.transitionState(agent, agent_1.AgentState.DIALING);
            // Initiate call with provider
            await this.placeCall(call, agent);
        }
    }
    selectBorrower(campaign) {
        if (campaign.borrowerList.length === 0)
            return null;
        const index = Math.floor(Math.random() * campaign.borrowerList.length);
        return campaign.borrowerList[index] || null;
    }
    async placeCall(call, agent) {
        // Select provider
        const providerName = this.selectProvider();
        const provider = this.providers.get(providerName);
        if (!provider) {
            await this.callManager.transitionCall(call.id, call_1.CallState.FAILED, "No provider available");
            this.agentManager.releaseAgent(agent.id, agent_1.AgentState.WRAP_UP);
            return;
        }
        try {
            // Transition call to INITIATED
            await this.callManager.transitionCall(call.id, call_1.CallState.INITIATED);
            const result = await provider.initiateCall({
                callId: call.id,
                phoneNumber: call.borrowerId,
                campaignId: call.campaignId,
            });
            // Store provider call ID
            await this.callManager.transitionCall(call.id, call_1.CallState.RINGING, undefined, result.providerCallId);
        }
        catch (error) {
            await this.callManager.transitionCall(call.id, call_1.CallState.FAILED, String(error));
            this.agentManager.releaseAgent(agent.id, agent_1.AgentState.WRAP_UP);
        }
    }
    selectProvider() {
        const providerNames = Array.from(this.providers.keys());
        const healthyProviders = providerNames.filter((name) => this.providers.get(name)?.isHealthy);
        if (healthyProviders.length === 0)
            return providerNames[0] || "";
        return healthyProviders[Math.floor(Math.random() * healthyProviders.length)] || "";
    }
    async handleProviderEvent(providerName, event) {
        const call = this.callManager.getCall(event.callId);
        if (!call)
            return;
        // Handle duplicate events
        if (this.isDuplicateEvent(call, event)) {
            return;
        }
        switch (event.status) {
            case "RINGING":
                await this.callManager.transitionCall(call.id, call_1.CallState.RINGING, undefined, event.providerCallId);
                break;
            case "ANSWERED":
                await this.handleCallAnswered(call, event);
                break;
            case "COMPLETED":
                await this.handleCallCompleted(call, event);
                break;
            case "FAILED":
            case "TIMEOUT":
                await this.handleCallFailed(call, event);
                break;
        }
    }
    isDuplicateEvent(call, event) {
        const lastEvent = call.stateHistory[call.stateHistory.length - 1];
        if (!lastEvent)
            return false;
        // Check if same state within short time window
        const timeDiff = event.timestamp - lastEvent.timestamp;
        return timeDiff < 100 && lastEvent.state === this.mapProviderStatus(event.status);
    }
    mapProviderStatus(status) {
        switch (status) {
            case "RINGING": return call_1.CallState.RINGING;
            case "ANSWERED": return call_1.CallState.ANSWERED;
            case "COMPLETED": return call_1.CallState.COMPLETED;
            case "FAILED":
            case "TIMEOUT": return call_1.CallState.FAILED;
            default: return call_1.CallState.QUEUED;
        }
    }
    async handleCallAnswered(call, event) {
        await this.callManager.transitionCall(call.id, call_1.CallState.ANSWERED, undefined, event.providerCallId);
        // Transition to CONNECTED
        await this.callManager.transitionCall(call.id, call_1.CallState.CONNECTED);
        // Update agent state
        if (call.agentId) {
            const agent = this.agentManager.getAgent(call.agentId);
            if (agent) {
                this.agentManager.transitionState(agent, agent_1.AgentState.CONNECTED);
            }
        }
    }
    async handleCallCompleted(call, event) {
        await this.callManager.transitionCall(call.id, call_1.CallState.COMPLETED, event.reason);
        // Release agent to WRAP_UP
        if (call.agentId) {
            this.agentManager.releaseAgent(call.agentId, agent_1.AgentState.WRAP_UP);
            // After a short delay, make agent available again
            setTimeout(() => {
                const agent = this.agentManager.getAgent(call.agentId);
                if (agent && agent.state === agent_1.AgentState.WRAP_UP) {
                    this.agentManager.releaseAgent(agent.id, agent_1.AgentState.AVAILABLE);
                }
            }, 5000); // 5 second wrap-up time
        }
        this.emit("call:completed", { callId: call.id, duration: event.duration });
    }
    async handleCallFailed(call, event) {
        await this.callManager.transitionCall(call.id, call_1.CallState.FAILED, event.reason);
        // Release agent to WRAP_UP
        if (call.agentId) {
            this.agentManager.releaseAgent(call.agentId, agent_1.AgentState.WRAP_UP);
            // Make available quickly after failure
            setTimeout(() => {
                const agent = this.agentManager.getAgent(call.agentId);
                if (agent && agent.state === agent_1.AgentState.WRAP_UP) {
                    this.agentManager.releaseAgent(agent.id, agent_1.AgentState.AVAILABLE);
                }
            }, 2000); // 2 second wrap-up after failure
        }
        this.emit("call:failed", { callId: call.id, reason: event.reason });
    }
    getMetrics(campaignId) {
        return this.metrics.get(campaignId);
    }
    getSafetyMetrics() {
        return this.safetyController.getMetrics();
    }
    getAgentManager() {
        return this.agentManager;
    }
    getCallManager() {
        return this.callManager;
    }
    async shutdown() {
        // Stop all pacing
        for (const [campaignId, interval] of this.pacingIntervals) {
            clearInterval(interval);
        }
        this.pacingIntervals.clear();
    }
}
exports.DialerOrchestrator = DialerOrchestrator;
//# sourceMappingURL=orchestrator.js.map