export interface PacingRequest {
  campaignId: string;
  requestedCalls: number;
  reason: string;
}

export type SafetyDecision =
  | { approved: true; allowedCalls: number }
  | { approved: false; reason: string };

export interface SafetyControllerInterface {
  evaluatePacing(request: PacingRequest, context: SafetyContext): SafetyDecision;
  reportEvent(event: SafetyEvent): void;
  getMetrics(): SafetyMetrics;
  reset(): void;
}

export interface SafetyContext {
  availableAgents: number;
  activeCalls: number;
  connectedCalls: number;
  ringingCalls: number;
  failedCallsLast5Min: number;
  totalCallsLast5Min: number;
  providerHealth: Record<string, boolean>;
  avgAnswerRate: number;
  avgCallDuration: number;
}

export interface SafetyEvent {
  type: "call_abandoned" | "call_failed" | "provider_degraded" | "agent_dropped";
  timestamp: number;
  campaignId: string;
  details?: Record<string, unknown>;
}

export interface SafetyMetrics {
  totalRequests: number;
  approved: number;
  reduced: number;
  rejected: number;
  fallbackToProgressive: number;
  lastDecision?: SafetyDecision;
}
