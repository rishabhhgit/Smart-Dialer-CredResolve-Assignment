"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentManager = exports.AgentState = void 0;
const events_1 = require("events");
var AgentState;
(function (AgentState) {
    AgentState["OFFLINE"] = "OFFLINE";
    AgentState["AVAILABLE"] = "AVAILABLE";
    AgentState["RESERVED"] = "RESERVED";
    AgentState["DIALING"] = "DIALING";
    AgentState["CONNECTED"] = "CONNECTED";
    AgentState["WRAP_UP"] = "WRAP_UP";
    AgentState["PAUSED"] = "PAUSED";
})(AgentState || (exports.AgentState = AgentState = {}));
const VALID_TRANSITIONS = {
    [AgentState.OFFLINE]: [AgentState.AVAILABLE],
    [AgentState.AVAILABLE]: [AgentState.RESERVED, AgentState.PAUSED, AgentState.OFFLINE],
    [AgentState.RESERVED]: [AgentState.DIALING, AgentState.AVAILABLE, AgentState.OFFLINE],
    [AgentState.DIALING]: [AgentState.CONNECTED, AgentState.WRAP_UP, AgentState.AVAILABLE, AgentState.OFFLINE],
    [AgentState.CONNECTED]: [AgentState.WRAP_UP, AgentState.OFFLINE],
    [AgentState.WRAP_UP]: [AgentState.AVAILABLE, AgentState.PAUSED, AgentState.OFFLINE],
    [AgentState.PAUSED]: [AgentState.AVAILABLE, AgentState.OFFLINE],
};
class AgentManager extends events_1.EventEmitter {
    agents = new Map();
    reservations = new Map();
    locks = new Map();
    createAgent(id, campaignId) {
        const agent = {
            id,
            state: AgentState.AVAILABLE,
            campaignId,
            currentCallId: null,
            reservedAt: null,
            lastStateChange: Date.now(),
        };
        this.agents.set(id, agent);
        this.emit("agent:created", agent);
        return agent;
    }
    getAgent(id) {
        return this.agents.get(id);
    }
    getAgentsByCampaign(campaignId) {
        return Array.from(this.agents.values()).filter((a) => a.campaignId === campaignId);
    }
    getAvailableAgents(campaignId) {
        return this.getAgentsByCampaign(campaignId).filter((a) => a.state === AgentState.AVAILABLE);
    }
    async acquireLock(agentId) {
        while (this.locks.has(agentId)) {
            await this.locks.get(agentId);
        }
        let release;
        const promise = new Promise((resolve) => {
            release = () => {
                this.locks.delete(agentId);
                resolve();
            };
        });
        this.locks.set(agentId, promise);
        return release;
    }
    async reserveAgent(agentId, callId, workerId) {
        const release = await this.acquireLock(agentId);
        try {
            const agent = this.agents.get(agentId);
            if (!agent || agent.state !== AgentState.AVAILABLE) {
                return null;
            }
            if (!this.transitionState(agent, AgentState.RESERVED)) {
                return null;
            }
            const reservation = {
                agentId,
                callId,
                reservedAt: Date.now(),
                workerId,
            };
            agent.currentCallId = callId;
            agent.reservedAt = Date.now();
            this.reservations.set(agentId, reservation);
            this.emit("agent:reserved", reservation);
            return reservation;
        }
        finally {
            release();
        }
    }
    releaseAgent(agentId, targetState = AgentState.AVAILABLE) {
        const agent = this.agents.get(agentId);
        if (!agent)
            return false;
        const validTargets = VALID_TRANSITIONS[agent.state];
        if (!validTargets.includes(targetState)) {
            return false;
        }
        agent.state = targetState;
        agent.currentCallId = null;
        agent.reservedAt = null;
        agent.lastStateChange = Date.now();
        this.reservations.delete(agentId);
        this.emit("agent:released", { agentId, targetState });
        return true;
    }
    transitionState(agent, newState) {
        const validTransitions = VALID_TRANSITIONS[agent.state];
        if (!validTransitions.includes(newState)) {
            return false;
        }
        agent.state = newState;
        agent.lastStateChange = Date.now();
        this.emit("agent:transition", { agentId: agent.id, from: agent.state, to: newState });
        return true;
    }
    setAgentOffline(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent)
            return false;
        agent.state = AgentState.OFFLINE;
        agent.currentCallId = null;
        agent.reservedAt = null;
        agent.lastStateChange = Date.now();
        this.reservations.delete(agentId);
        this.emit("agent:offline", { agentId });
        return true;
    }
    getReservation(agentId) {
        return this.reservations.get(agentId);
    }
}
exports.AgentManager = AgentManager;
//# sourceMappingURL=agent.js.map