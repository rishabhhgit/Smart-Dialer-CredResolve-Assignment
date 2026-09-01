"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CallManager = exports.CallState = void 0;
const events_1 = require("events");
var CallState;
(function (CallState) {
    CallState["QUEUED"] = "QUEUED";
    CallState["RESERVED"] = "RESERVED";
    CallState["INITIATED"] = "INITIATED";
    CallState["RINGING"] = "RINGING";
    CallState["ANSWERED"] = "ANSWERED";
    CallState["CONNECTED"] = "CONNECTED";
    CallState["COMPLETED"] = "COMPLETED";
    CallState["FAILED"] = "FAILED";
    CallState["CANCELLED"] = "CANCELLED";
})(CallState || (exports.CallState = CallState = {}));
const VALID_CALL_TRANSITIONS = {
    [CallState.QUEUED]: [CallState.RESERVED, CallState.CANCELLED, CallState.FAILED],
    [CallState.RESERVED]: [CallState.INITIATED, CallState.CANCELLED, CallState.FAILED],
    [CallState.INITIATED]: [CallState.RINGING, CallState.FAILED, CallState.CANCELLED],
    [CallState.RINGING]: [CallState.ANSWERED, CallState.FAILED, CallState.CANCELLED],
    [CallState.ANSWERED]: [CallState.CONNECTED, CallState.FAILED, CallState.COMPLETED],
    [CallState.CONNECTED]: [CallState.COMPLETED, CallState.FAILED],
    [CallState.COMPLETED]: [],
    [CallState.FAILED]: [],
    [CallState.CANCELLED]: [],
};
class CallManager extends events_1.EventEmitter {
    calls = new Map();
    providerCallIndex = new Map();
    locks = new Map();
    createCall(campaignId, borrowerId) {
        const id = `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const call = {
            id,
            campaignId,
            borrowerId,
            agentId: null,
            providerCallId: null,
            state: CallState.QUEUED,
            createdAt: Date.now(),
            lastStateChange: Date.now(),
            stateHistory: [{ state: CallState.QUEUED, timestamp: Date.now() }],
            attempts: 0,
        };
        this.calls.set(id, call);
        this.emit("call:created", call);
        return call;
    }
    getCall(id) {
        return this.calls.get(id);
    }
    getQueuedCalls(campaignId) {
        return Array.from(this.calls.values()).filter((c) => c.campaignId === campaignId && c.state === CallState.QUEUED);
    }
    getCallsByCampaign(campaignId) {
        return Array.from(this.calls.values()).filter((c) => c.campaignId === campaignId);
    }
    async acquireLock(callId) {
        while (this.locks.has(callId)) {
            await this.locks.get(callId);
        }
        let release;
        const promise = new Promise((resolve) => {
            release = () => {
                this.locks.delete(callId);
                resolve();
            };
        });
        this.locks.set(callId, promise);
        return release;
    }
    async transitionCall(callId, newState, reason, providerCallId) {
        const release = await this.acquireLock(callId);
        try {
            const call = this.calls.get(callId);
            if (!call)
                return false;
            const validTransitions = VALID_CALL_TRANSITIONS[call.state];
            if (!validTransitions.includes(newState)) {
                return false;
            }
            call.state = newState;
            call.lastStateChange = Date.now();
            call.stateHistory.push({ state: newState, timestamp: Date.now(), reason });
            if (providerCallId) {
                call.providerCallId = providerCallId;
                this.providerCallIndex.set(providerCallId, callId);
            }
            this.emit("call:transition", {
                callId,
                state: newState,
                timestamp: Date.now(),
                reason,
                providerCallId,
            });
            return true;
        }
        finally {
            release();
        }
    }
    assignAgent(callId, agentId) {
        const call = this.calls.get(callId);
        if (!call || call.state !== CallState.QUEUED)
            return false;
        call.agentId = agentId;
        return true;
    }
    getCallByProviderId(providerCallId) {
        const callId = this.providerCallIndex.get(providerCallId);
        return callId ? this.calls.get(callId) : undefined;
    }
    getActiveCalls(campaignId) {
        return this.getCallsByCampaign(campaignId).filter((c) => c.state !== CallState.COMPLETED &&
            c.state !== CallState.FAILED &&
            c.state !== CallState.CANCELLED);
    }
    getConnectedCalls(campaignId) {
        return this.getCallsByCampaign(campaignId).filter((c) => c.state === CallState.CONNECTED);
    }
    getRingingCalls(campaignId) {
        return this.getCallsByCampaign(campaignId).filter((c) => c.state === CallState.RINGING);
    }
    getInitiatedCalls(campaignId) {
        return this.getCallsByCampaign(campaignId).filter((c) => c.state === CallState.INITIATED || c.state === CallState.RINGING);
    }
}
exports.CallManager = CallManager;
//# sourceMappingURL=call.js.map