import { EventEmitter } from "events";

export enum CallState {
  QUEUED = "QUEUED",
  RESERVED = "RESERVED",
  INITIATED = "INITIATED",
  RINGING = "RINGING",
  ANSWERED = "ANSWERED",
  CONNECTED = "CONNECTED",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

export interface Call {
  id: string;
  campaignId: string;
  borrowerId: string;
  agentId: string | null;
  providerCallId: string | null;
  state: CallState;
  createdAt: number;
  lastStateChange: number;
  stateHistory: { state: CallState; timestamp: number; reason?: string }[];
  attempts: number;
}

export interface CallEvent {
  callId: string;
  state: CallState;
  timestamp: number;
  reason?: string;
  providerCallId?: string;
}

const VALID_CALL_TRANSITIONS: Record<CallState, CallState[]> = {
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

export class CallManager extends EventEmitter {
  private calls: Map<string, Call> = new Map();
  private providerCallIndex: Map<string, string> = new Map();
  private locks: Map<string, Promise<void>> = new Map();

  createCall(campaignId: string, borrowerId: string): Call {
    const id = `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const call: Call = {
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

  getCall(id: string): Call | undefined {
    return this.calls.get(id);
  }

  getQueuedCalls(campaignId: string): Call[] {
    return Array.from(this.calls.values()).filter(
      (c) => c.campaignId === campaignId && c.state === CallState.QUEUED
    );
  }

  getCallsByCampaign(campaignId: string): Call[] {
    return Array.from(this.calls.values()).filter(
      (c) => c.campaignId === campaignId
    );
  }

  private async acquireLock(callId: string): Promise<() => void> {
    while (this.locks.has(callId)) {
      await this.locks.get(callId);
    }
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = () => {
        this.locks.delete(callId);
        resolve();
      };
    });
    this.locks.set(callId, promise);
    return release;
  }

  async transitionCall(
    callId: string,
    newState: CallState,
    reason?: string,
    providerCallId?: string
  ): Promise<boolean> {
    const release = await this.acquireLock(callId);
    try {
      const call = this.calls.get(callId);
      if (!call) return false;

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
    } finally {
      release();
    }
  }

  assignAgent(callId: string, agentId: string): boolean {
    const call = this.calls.get(callId);
    if (!call || call.state !== CallState.QUEUED) return false;
    call.agentId = agentId;
    return true;
  }

  getCallByProviderId(providerCallId: string): Call | undefined {
    const callId = this.providerCallIndex.get(providerCallId);
    return callId ? this.calls.get(callId) : undefined;
  }

  getActiveCalls(campaignId: string): Call[] {
    return this.getCallsByCampaign(campaignId).filter(
      (c) =>
        c.state !== CallState.COMPLETED &&
        c.state !== CallState.FAILED &&
        c.state !== CallState.CANCELLED
    );
  }

  getConnectedCalls(campaignId: string): Call[] {
    return this.getCallsByCampaign(campaignId).filter(
      (c) => c.state === CallState.CONNECTED
    );
  }

  getRingingCalls(campaignId: string): Call[] {
    return this.getCallsByCampaign(campaignId).filter(
      (c) => c.state === CallState.RINGING
    );
  }

  getInitiatedCalls(campaignId: string): Call[] {
    return this.getCallsByCampaign(campaignId).filter(
      (c) => c.state === CallState.INITIATED || c.state === CallState.RINGING
    );
  }
}
