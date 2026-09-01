import { Agent, AgentState, AgentReservation } from "../models/agent";
import { Call, CallState } from "../models/call";

export interface SharedAgentState {
  id: string;
  state: AgentState;
  campaignId: string;
  currentCallId: string | null;
  version: number;
}

export interface SharedCallState {
  id: string;
  state: CallState;
  campaignId: string;
  borrowerId: string;
  agentId: string | null;
  version: number;
}

export class SharedStateManager {
  private agents: Map<string, SharedAgentState> = new Map();
  private calls: Map<string, SharedCallState> = new Map();
  private agentLocks: Map<string, Promise<boolean>> = new Map();
  private callLocks: Map<string, Promise<boolean>> = new Map();

  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, {
      id: agent.id,
      state: agent.state,
      campaignId: agent.campaignId,
      currentCallId: agent.currentCallId,
      version: 0,
    });
  }

  registerCall(call: Call): void {
    this.calls.set(call.id, {
      id: call.id,
      state: call.state,
      campaignId: call.campaignId,
      borrowerId: call.borrowerId,
      agentId: call.agentId,
      version: 0,
    });
  }

  async tryReserveAgent(
    agentId: string,
    callId: string,
    workerId: string
  ): Promise<boolean> {
    while (this.agentLocks.has(agentId)) {
      await this.agentLocks.get(agentId);
    }

    let release!: (result: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    this.agentLocks.set(agentId, promise);

    try {
      const agent = this.agents.get(agentId);
      if (!agent || agent.state !== AgentState.AVAILABLE) {
        release(false);
        return false;
      }

      agent.state = AgentState.RESERVED;
      agent.currentCallId = callId;
      agent.version++;

      const call = this.calls.get(callId);
      if (call) {
        call.agentId = agentId;
        call.version++;
      }

      release(true);
      return true;
    } finally {
      this.agentLocks.delete(agentId);
    }
  }

  async updateAgentState(
    agentId: string,
    newState: AgentState
  ): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.state = newState;
    agent.version++;
    return true;
  }

  async updateCallState(
    callId: string,
    newState: CallState,
    reason?: string
  ): Promise<boolean> {
    const call = this.calls.get(callId);
    if (!call) return false;

    const validTransitions: Record<CallState, CallState[]> = {
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

    if (!validTransitions[call.state]?.includes(newState)) {
      return false;
    }

    call.state = newState;
    call.version++;
    return true;
  }

  getAgent(agentId: string): SharedAgentState | undefined {
    return this.agents.get(agentId);
  }

  getCall(callId: string): SharedCallState | undefined {
    return this.calls.get(callId);
  }

  getAvailableAgents(campaignId: string): SharedAgentState[] {
    return Array.from(this.agents.values()).filter(
      (a) => a.campaignId === campaignId && a.state === AgentState.AVAILABLE
    );
  }

  getActiveCalls(campaignId: string): SharedCallState[] {
    return Array.from(this.calls.values()).filter(
      (c) =>
        c.campaignId === campaignId &&
        c.state !== CallState.COMPLETED &&
        c.state !== CallState.FAILED &&
        c.state !== CallState.CANCELLED
    );
  }

  getStats(campaignId: string) {
    const agents = Array.from(this.agents.values()).filter(
      (a) => a.campaignId === campaignId
    );
    const calls = Array.from(this.calls.values()).filter(
      (c) => c.campaignId === campaignId
    );

    return {
      totalAgents: agents.length,
      availableAgents: agents.filter((a) => a.state === AgentState.AVAILABLE).length,
      reservedAgents: agents.filter((a) => a.state === AgentState.RESERVED).length,
      totalCalls: calls.length,
      activeCalls: calls.filter(
        (c) =>
          c.state !== CallState.COMPLETED &&
          c.state !== CallState.FAILED &&
          c.state !== CallState.CANCELLED
      ).length,
      connectedCalls: calls.filter((c) => c.state === CallState.CONNECTED).length,
      failedCalls: calls.filter((c) => c.state === CallState.FAILED).length,
      completedCalls: calls.filter((c) => c.state === CallState.COMPLETED).length,
    };
  }
}
