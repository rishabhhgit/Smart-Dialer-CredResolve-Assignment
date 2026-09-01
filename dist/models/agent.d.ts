import { EventEmitter } from "events";
export declare enum AgentState {
    OFFLINE = "OFFLINE",
    AVAILABLE = "AVAILABLE",
    RESERVED = "RESERVED",
    DIALING = "DIALING",
    CONNECTED = "CONNECTED",
    WRAP_UP = "WRAP_UP",
    PAUSED = "PAUSED"
}
export interface Agent {
    id: string;
    state: AgentState;
    campaignId: string;
    currentCallId: string | null;
    reservedAt: number | null;
    lastStateChange: number;
}
export interface AgentReservation {
    agentId: string;
    callId: string;
    reservedAt: number;
    workerId: string;
}
export declare class AgentManager extends EventEmitter {
    private agents;
    private reservations;
    private locks;
    createAgent(id: string, campaignId: string): Agent;
    getAgent(id: string): Agent | undefined;
    getAgentsByCampaign(campaignId: string): Agent[];
    getAvailableAgents(campaignId: string): Agent[];
    private acquireLock;
    reserveAgent(agentId: string, callId: string, workerId: string): Promise<AgentReservation | null>;
    releaseAgent(agentId: string, targetState?: AgentState): boolean;
    transitionState(agent: Agent, newState: AgentState): boolean;
    setAgentOffline(agentId: string): boolean;
    getReservation(agentId: string): AgentReservation | undefined;
}
//# sourceMappingURL=agent.d.ts.map