import { EventEmitter } from "events";

export enum AgentState {
  OFFLINE = "OFFLINE",
  AVAILABLE = "AVAILABLE",
  RESERVED = "RESERVED",
  DIALING = "DIALING",
  CONNECTED = "CONNECTED",
  WRAP_UP = "WRAP_UP",
  PAUSED = "PAUSED",
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

const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  [AgentState.OFFLINE]: [AgentState.AVAILABLE],
  [AgentState.AVAILABLE]: [AgentState.RESERVED, AgentState.PAUSED, AgentState.OFFLINE],
  [AgentState.RESERVED]: [AgentState.DIALING, AgentState.AVAILABLE, AgentState.OFFLINE],
  [AgentState.DIALING]: [AgentState.CONNECTED, AgentState.WRAP_UP, AgentState.AVAILABLE, AgentState.OFFLINE],
  [AgentState.CONNECTED]: [AgentState.WRAP_UP, AgentState.OFFLINE],
  [AgentState.WRAP_UP]: [AgentState.AVAILABLE, AgentState.PAUSED, AgentState.OFFLINE],
  [AgentState.PAUSED]: [AgentState.AVAILABLE, AgentState.OFFLINE],
};

export class AgentManager extends EventEmitter {
  private agents: Map<string, Agent> = new Map();
  private reservations: Map<string, AgentReservation> = new Map();
  private locks: Map<string, Promise<void>> = new Map();

  createAgent(id: string, campaignId: string): Agent {
    const agent: Agent = {
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

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getAgentsByCampaign(campaignId: string): Agent[] {
    return Array.from(this.agents.values()).filter(
      (a) => a.campaignId === campaignId
    );
  }

  getAvailableAgents(campaignId: string): Agent[] {
    return this.getAgentsByCampaign(campaignId).filter(
      (a) => a.state === AgentState.AVAILABLE
    );
  }

  private async acquireLock(agentId: string): Promise<() => void> {
    while (this.locks.has(agentId)) {
      await this.locks.get(agentId);
    }
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = () => {
        this.locks.delete(agentId);
        resolve();
      };
    });
    this.locks.set(agentId, promise);
    return release;
  }

  async reserveAgent(
    agentId: string,
    callId: string,
    workerId: string
  ): Promise<AgentReservation | null> {
    const release = await this.acquireLock(agentId);
    try {
      const agent = this.agents.get(agentId);
      if (!agent || agent.state !== AgentState.AVAILABLE) {
        return null;
      }

      if (!this.transitionState(agent, AgentState.RESERVED)) {
        return null;
      }

      const reservation: AgentReservation = {
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
    } finally {
      release();
    }
  }

  releaseAgent(agentId: string, targetState: AgentState = AgentState.AVAILABLE): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

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

  transitionState(agent: Agent, newState: AgentState): boolean {
    const validTransitions = VALID_TRANSITIONS[agent.state];
    if (!validTransitions.includes(newState)) {
      return false;
    }
    const oldState = agent.state;
    agent.state = newState;
    agent.lastStateChange = Date.now();
    this.emit("agent:transition", { agentId: agent.id, from: oldState, to: newState });
    return true;
  }

  setAgentOffline(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.state = AgentState.OFFLINE;
    agent.currentCallId = null;
    agent.reservedAt = null;
    agent.lastStateChange = Date.now();
    this.reservations.delete(agentId);
    this.emit("agent:offline", { agentId });
    return true;
  }

  getReservation(agentId: string): AgentReservation | undefined {
    return this.reservations.get(agentId);
  }
}
