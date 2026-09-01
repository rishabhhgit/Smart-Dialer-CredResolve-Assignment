import { Agent } from "../models/agent";
import { Call } from "../models/call";

export interface Campaign {
  id: string;
  name: string;
  borrowerList: string[];
  mode: "progressive" | "predictive";
  status: "active" | "paused" | "completed";
  createdAt: number;
}

export interface DialerMetrics {
  campaignId: string;
  totalAgents: number;
  availableAgents: number;
  totalCalls: number;
  activeCalls: number;
  connectedCalls: number;
  failedCalls: number;
  completionRate: number;
  avgWaitTime: number;
  utilization: number;
  pacingDecisions: number;
  safetyDecisions: number;
}

export interface WorkerJob {
  id: string;
  campaignId: string;
  callId: string;
  agentId: string;
  workerId: string;
  state: "pending" | "in_progress" | "completed" | "failed";
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}
