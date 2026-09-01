import { EventEmitter } from "events";
import { AgentManager, Agent, AgentState } from "../models/agent";
import { CallManager, Call, CallState } from "../models/call";
import { TelecomProvider, ProviderCallEvent } from "../providers/types";
import { SafetyController } from "../safety/controller";
import { SafetyContext } from "../safety/types";
import { PacingEngine, DialContext } from "../engine/types";
import { ProgressiveDialer } from "../engine/progressive";
import { PredictiveDialer } from "../engine/predictive";
import { Campaign, DialerMetrics } from "./types";

export class DialerOrchestrator extends EventEmitter {
  private agentManager: AgentManager;
  private callManager: CallManager;
  private safetyController: SafetyController;
  private providers: Map<string, TelecomProvider> = new Map();
  private campaigns: Map<string, Campaign> = new Map();
  private pacingEngines: Map<string, PacingEngine> = new Map();
  private metrics: Map<string, DialerMetrics> = new Map();
  private pacingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private eventBuffer: Map<string, ProviderCallEvent[]> = new Map();
  private readonly workerId: string;

  constructor(workerId?: string) {
    super();
    this.workerId = workerId || `worker_${Date.now()}`;
    this.agentManager = new AgentManager();
    this.callManager = new CallManager();
    this.safetyController = new SafetyController();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.agentManager.on("agent:transition", (data) => {
      this.emit("agent:transition", data);
    });

    this.callManager.on("call:transition", (data) => {
      this.emit("call:transition", data);
    });
  }

  registerProvider(provider: TelecomProvider): void {
    this.providers.set(provider.name, provider);
    provider.onEvent((event) => this.handleProviderEvent(provider.name, event));
  }

  createCampaign(config: { id: string; name: string; borrowerList: string[]; mode: "progressive" | "predictive" }): Campaign {
    const campaign: Campaign = {
      ...config,
      status: "active",
      createdAt: Date.now(),
    };
    this.campaigns.set(config.id, campaign);

    // Set up pacing engine
    if (config.mode === "progressive") {
      this.pacingEngines.set(config.id, new ProgressiveDialer());
    } else {
      this.pacingEngines.set(config.id, new PredictiveDialer());
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

  addAgent(agentId: string, campaignId: string): Agent {
    return this.agentManager.createAgent(agentId, campaignId);
  }

  startPacing(campaignId: string, intervalMs: number = 1000): void {
    if (this.pacingIntervals.has(campaignId)) {
      return;
    }

    const interval = setInterval(() => {
      this.runPacingCycle(campaignId);
    }, intervalMs);

    this.pacingIntervals.set(campaignId, interval);
  }

  stopPacing(campaignId: string): void {
    const interval = this.pacingIntervals.get(campaignId);
    if (interval) {
      clearInterval(interval);
      this.pacingIntervals.delete(campaignId);
    }
  }

  private async runPacingCycle(campaignId: string): Promise<void> {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign || campaign.status !== "active") return;

    const engine = this.pacingEngines.get(campaignId);
    if (!engine) return;

    const dialContext = this.getDialContext(campaignId);
    const requestedCalls = engine.calculateDialRate(campaignId, dialContext);

    // Convert to safety context
    const safetyContext = this.getSafetyContext(campaignId, dialContext);

    // Send to safety controller
    const decision = this.safetyController.evaluatePacing(
      {
        campaignId,
        requestedCalls,
        reason: `Pacing cycle for ${engine.name} engine`,
      },
      safetyContext
    );

    if (!decision.approved) {
      this.emit("safety:rejected", { campaignId, requestedCalls, reason: decision.reason });
      return;
    }

    const callsToMake = decision.allowedCalls;
    if (callsToMake <= 0) return;

    // Initiate calls
    await this.initiateCalls(campaignId, callsToMake);
  }

  private getDialContext(campaignId: string): DialContext {
    const agents = this.agentManager.getAgentsByCampaign(campaignId);
    const available = agents.filter((a) => a.state === AgentState.AVAILABLE);
    const active = this.callManager.getActiveCalls(campaignId);
    const connected = this.callManager.getConnectedCalls(campaignId);
    const ringing = this.callManager.getRingingCalls(campaignId);

    const callsInLastMinute = active.filter(
      (c) => Date.now() - c.createdAt < 60000
    ).length;
    const answeredInLastMinute = connected.filter(
      (c) => Date.now() - c.createdAt < 60000
    ).length;

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

  private getSafetyContext(campaignId: string, dialContext: DialContext): SafetyContext {
    const calls = this.callManager.getCallsByCampaign(campaignId);
    const recentCalls = calls.filter((c) => Date.now() - c.createdAt < 300000); // Last 5 min
    const failedRecent = recentCalls.filter((c) => c.state === CallState.FAILED).length;

    const providerHealth: Record<string, boolean> = {};
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

  private calculateAnswerRate(campaignId: string): number {
    const calls = this.callManager.getCallsByCampaign(campaignId);
    const completed = calls.filter(
      (c) =>
        c.state === CallState.COMPLETED ||
        c.state === CallState.CONNECTED ||
        c.state === CallState.FAILED
    );
    if (completed.length === 0) return 0.5; // Default

    const answered = completed.filter(
      (c) => c.state === CallState.COMPLETED || c.state === CallState.CONNECTED
    );
    return answered.length / completed.length;
  }

  private calculateAvgCallDuration(campaignId: string): number {
    const calls = this.callManager.getCallsByCampaign(campaignId);
    const completed = calls.filter((c) => c.state === CallState.COMPLETED);
    if (completed.length === 0) return 120; // Default 2 minutes

    const durations = completed
      .map((c) => {
        const history = c.stateHistory;
        const start = history.find((h) => h.state === CallState.CONNECTED);
        const end = history.find((h) => h.state === CallState.COMPLETED);
        if (start && end) return end.timestamp - start.timestamp;
        return 120000;
      })
      .filter((d) => d > 0);

    return durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length / 1000
      : 120;
  }

  async initiateCalls(campaignId: string, count: number): Promise<void> {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) return;

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
      const agent = availableAgents.find((a) => a.state === AgentState.AVAILABLE);
      if (!agent) break;

      // Reserve agent
      const reservation = await this.agentManager.reserveAgent(
        agent.id,
        call.id,
        this.workerId
      );

      if (!reservation) continue; // Agent was taken by another worker

      // Assign agent to call
      this.callManager.assignAgent(call.id, agent.id);

      // Transition call to RESERVED
      await this.callManager.transitionCall(call.id, CallState.RESERVED);

      // Transition agent to DIALING
      this.agentManager.transitionState(agent, AgentState.DIALING);

      // Initiate call with provider
      await this.placeCall(call, agent);
    }
  }

  private selectBorrower(campaign: Campaign): string | null {
    if (campaign.borrowerList.length === 0) return null;
    const index = Math.floor(Math.random() * campaign.borrowerList.length);
    return campaign.borrowerList[index] || null;
  }

  private async placeCall(call: Call, agent: Agent): Promise<void> {
    // Select provider
    const providerName = this.selectProvider();
    const provider = this.providers.get(providerName);
    if (!provider) {
      await this.callManager.transitionCall(call.id, CallState.FAILED, "No provider available");
      this.agentManager.releaseAgent(agent.id, AgentState.WRAP_UP);
      return;
    }

    try {
      // Transition call to INITIATED
      await this.callManager.transitionCall(call.id, CallState.INITIATED);

      const result = await provider.initiateCall({
        callId: call.id,
        phoneNumber: call.borrowerId,
        campaignId: call.campaignId,
      });

      // Store provider call ID
      await this.callManager.transitionCall(
        call.id,
        CallState.RINGING,
        undefined,
        result.providerCallId
      );
    } catch (error) {
      await this.callManager.transitionCall(call.id, CallState.FAILED, String(error));
      this.agentManager.releaseAgent(agent.id, AgentState.WRAP_UP);
    }
  }

  private selectProvider(): string {
    const providerNames = Array.from(this.providers.keys());
    const healthyProviders = providerNames.filter(
      (name) => this.providers.get(name)?.isHealthy
    );

    if (healthyProviders.length === 0) return providerNames[0] || "";
    return healthyProviders[Math.floor(Math.random() * healthyProviders.length)] || "";
  }

  private async handleProviderEvent(
    providerName: string,
    event: ProviderCallEvent
  ): Promise<void> {
    const call = this.callManager.getCall(event.callId);
    if (!call) return;

    // Handle duplicate events
    if (this.isDuplicateEvent(call, event)) {
      return;
    }

    switch (event.status) {
      case "RINGING":
        await this.callManager.transitionCall(call.id, CallState.RINGING, undefined, event.providerCallId);
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

  private isDuplicateEvent(call: Call, event: ProviderCallEvent): boolean {
    const lastEvent = call.stateHistory[call.stateHistory.length - 1];
    if (!lastEvent) return false;

    // Check if same state within short time window
    const timeDiff = event.timestamp - lastEvent.timestamp;
    return timeDiff < 100 && lastEvent.state === this.mapProviderStatus(event.status);
  }

  private mapProviderStatus(status: string): CallState {
    switch (status) {
      case "RINGING": return CallState.RINGING;
      case "ANSWERED": return CallState.ANSWERED;
      case "COMPLETED": return CallState.COMPLETED;
      case "FAILED":
      case "TIMEOUT": return CallState.FAILED;
      default: return CallState.QUEUED;
    }
  }

  private async handleCallAnswered(call: Call, event: ProviderCallEvent): Promise<void> {
    await this.callManager.transitionCall(call.id, CallState.ANSWERED, undefined, event.providerCallId);

    // Transition to CONNECTED
    await this.callManager.transitionCall(call.id, CallState.CONNECTED);

    // Update agent state
    if (call.agentId) {
      const agent = this.agentManager.getAgent(call.agentId);
      if (agent) {
        this.agentManager.transitionState(agent, AgentState.CONNECTED);
      }
    }
  }

  private async handleCallCompleted(call: Call, event: ProviderCallEvent): Promise<void> {
    await this.callManager.transitionCall(call.id, CallState.COMPLETED, event.reason);

    // Release agent to WRAP_UP
    if (call.agentId) {
      this.agentManager.releaseAgent(call.agentId, AgentState.WRAP_UP);

      // After a short delay, make agent available again
      setTimeout(() => {
        const agent = this.agentManager.getAgent(call.agentId!);
        if (agent && agent.state === AgentState.WRAP_UP) {
          this.agentManager.releaseAgent(agent.id, AgentState.AVAILABLE);
        }
      }, 5000); // 5 second wrap-up time
    }

    this.emit("call:completed", { callId: call.id, duration: event.duration });
  }

  private async handleCallFailed(call: Call, event: ProviderCallEvent): Promise<void> {
    await this.callManager.transitionCall(call.id, CallState.FAILED, event.reason);

    // Release agent to WRAP_UP
    if (call.agentId) {
      this.agentManager.releaseAgent(call.agentId, AgentState.WRAP_UP);

      // Make available quickly after failure
      setTimeout(() => {
        const agent = this.agentManager.getAgent(call.agentId!);
        if (agent && agent.state === AgentState.WRAP_UP) {
          this.agentManager.releaseAgent(agent.id, AgentState.AVAILABLE);
        }
      }, 2000); // 2 second wrap-up after failure
    }

    this.emit("call:failed", { callId: call.id, reason: event.reason });
  }

  getMetrics(campaignId: string): DialerMetrics | undefined {
    return this.metrics.get(campaignId);
  }

  getSafetyMetrics() {
    return this.safetyController.getMetrics();
  }

  getAgentManager(): AgentManager {
    return this.agentManager;
  }

  getCallManager(): CallManager {
    return this.callManager;
  }

  getProviderHealth(): Record<string, boolean> {
    const health: Record<string, boolean> = {};
    for (const [name, provider] of this.providers) {
      health[name] = provider.isHealthy;
    }
    return health;
  }

  setProviderHealth(providerName: string, healthy: boolean): void {
    const provider = this.providers.get(providerName);
    if (provider && "setHealthy" in provider) {
      (provider as any).setHealthy(healthy);
    }
  }

  removeAgent(agentId: string): void {
    this.agentManager.setAgentOffline(agentId);
  }

  async shutdown(): Promise<void> {
    for (const [campaignId, interval] of this.pacingIntervals) {
      clearInterval(interval);
    }
    this.pacingIntervals.clear();
  }
}
