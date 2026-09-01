import { EventEmitter } from "events";
export declare enum CallState {
    QUEUED = "QUEUED",
    RESERVED = "RESERVED",
    INITIATED = "INITIATED",
    RINGING = "RINGING",
    ANSWERED = "ANSWERED",
    CONNECTED = "CONNECTED",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED",
    CANCELLED = "CANCELLED"
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
    stateHistory: {
        state: CallState;
        timestamp: number;
        reason?: string;
    }[];
    attempts: number;
}
export interface CallEvent {
    callId: string;
    state: CallState;
    timestamp: number;
    reason?: string;
    providerCallId?: string;
}
export declare class CallManager extends EventEmitter {
    private calls;
    private providerCallIndex;
    private locks;
    createCall(campaignId: string, borrowerId: string): Call;
    getCall(id: string): Call | undefined;
    getQueuedCalls(campaignId: string): Call[];
    getCallsByCampaign(campaignId: string): Call[];
    private acquireLock;
    transitionCall(callId: string, newState: CallState, reason?: string, providerCallId?: string): Promise<boolean>;
    assignAgent(callId: string, agentId: string): boolean;
    getCallByProviderId(providerCallId: string): Call | undefined;
    getActiveCalls(campaignId: string): Call[];
    getConnectedCalls(campaignId: string): Call[];
    getRingingCalls(campaignId: string): Call[];
    getInitiatedCalls(campaignId: string): Call[];
}
//# sourceMappingURL=call.d.ts.map