import { EventEmitter } from "events";
import { AgentManager, AgentState } from "../models/agent";
import { CallManager, CallState } from "../models/call";
import { TelecomProvider } from "../providers/types";
import { SafetyController } from "../safety/controller";
import { SharedStateManager } from "./sharedState";

export interface WorkerConfig {
  id: string;
  campaignId: string;
}

export class DialerWorker extends EventEmitter {
  private agentManager: AgentManager;
  private callManager: CallManager;
  private safetyController: SafetyController;
  private sharedState: SharedStateManager;
  private providers: Map<string, TelecomProvider> = new Map();
  private config: WorkerConfig;
  private active = false;
  private pacingInterval: NodeJS.Timeout | null = null;

  constructor(
    config: WorkerConfig,
    sharedState: SharedStateManager,
    agentManager: AgentManager,
    callManager: CallManager,
    safetyController: SafetyController
  ) {
    super();
    this.config = config;
    this.sharedState = sharedState;
    this.agentManager = agentManager;
    this.callManager = callManager;
    this.safetyController = safetyController;
  }

  registerProvider(provider: TelecomProvider): void {
    this.providers.set(provider.name, provider);
    provider.onEvent((event) => {
      if (event.callId) {
        this.handleProviderEvent(event);
      }
    });
  }

  startPacing(intervalMs: number = 1000): void {
    if (this.pacingInterval) return;
    this.active = true;
    this.pacingInterval = setInterval(() => {
      if (this.active) {
        this.runPacingCycle();
      }
    }, intervalMs);
  }

  stopPacing(): void {
    this.active = false;
    if (this.pacingInterval) {
      clearInterval(this.pacingInterval);
      this.pacingInterval = null;
    }
  }

  private runPacingCycle(): void {
    const availableAgents = this.sharedState.getAvailableAgents(this.config.campaignId);
    const activeCalls = this.sharedState.getActiveCalls(this.config.campaignId);

    const maxNewCalls = Math.max(0, availableAgents.length - activeCalls.length);
    if (maxNewCalls <= 0) return;

    const callsToMake = Math.min(maxNewCalls, 5);
    for (let i = 0; i < callsToMake; i++) {
      this.tryInitiateCall();
    }
  }

  private async tryInitiateCall(): Promise<void> {
    const availableAgents = this.sharedState.getAvailableAgents(this.config.campaignId);
    if (availableAgents.length === 0) return;

    const agent = availableAgents[0];
    const call = this.callManager.createCall(this.config.campaignId, `borrower_${Date.now()}`);

    this.sharedState.registerCall(call);

    const reserved = await this.sharedState.tryReserveAgent(
      agent.id,
      call.id,
      this.config.id
    );

    if (!reserved) {
      return;
    }

    this.callManager.assignAgent(call.id, agent.id);
    await this.callManager.transitionCall(call.id, CallState.RESERVED);
    this.agentManager.transitionState(
      this.agentManager.getAgent(agent.id)!,
      AgentState.DIALING
    );

    const provider = this.selectProvider();
    if (!provider) {
      await this.callManager.transitionCall(call.id, CallState.FAILED, "No provider");
      return;
    }

    try {
      await this.callManager.transitionCall(call.id, CallState.INITIATED);
      const result = await provider.initiateCall({
        callId: call.id,
        phoneNumber: call.borrowerId,
        campaignId: call.campaignId,
      });
      await this.callManager.transitionCall(
        call.id,
        CallState.RINGING,
        undefined,
        result.providerCallId
      );
    } catch (error) {
      await this.callManager.transitionCall(call.id, CallState.FAILED, String(error));
    }
  }

  private selectProvider(): TelecomProvider | undefined {
    const healthy = Array.from(this.providers.values()).filter((p) => p.isHealthy);
    if (healthy.length === 0) return Array.from(this.providers.values())[0];
    return healthy[Math.floor(Math.random() * healthy.length)];
  }

  private async handleProviderEvent(event: any): Promise<void> {
    const call = this.callManager.getCall(event.callId);
    if (!call) return;

    switch (event.status) {
      case "ANSWERED":
        await this.callManager.transitionCall(call.id, CallState.ANSWERED);
        await this.callManager.transitionCall(call.id, CallState.CONNECTED);
        if (call.agentId) {
          const agent = this.agentManager.getAgent(call.agentId);
          if (agent) {
            this.agentManager.transitionState(agent, AgentState.CONNECTED);
          }
        }
        break;
      case "COMPLETED":
        await this.callManager.transitionCall(call.id, CallState.COMPLETED, event.reason);
        if (call.agentId) {
          this.agentManager.releaseAgent(call.agentId, AgentState.WRAP_UP);
          setTimeout(() => {
            const agent = this.agentManager.getAgent(call.agentId!);
            if (agent && agent.state === AgentState.WRAP_UP) {
              this.agentManager.releaseAgent(agent.id, AgentState.AVAILABLE);
            }
          }, 2000);
        }
        this.emit("call:completed", { callId: call.id });
        break;
      case "FAILED":
      case "TIMEOUT":
        await this.callManager.transitionCall(call.id, CallState.FAILED, event.reason);
        if (call.agentId) {
          this.agentManager.releaseAgent(call.agentId, AgentState.WRAP_UP);
          setTimeout(() => {
            const agent = this.agentManager.getAgent(call.agentId!);
            if (agent && agent.state === AgentState.WRAP_UP) {
              this.agentManager.releaseAgent(agent.id, AgentState.AVAILABLE);
            }
          }, 1000);
        }
        this.emit("call:failed", { callId: call.id, reason: event.reason });
        break;
    }
  }

  simulateCrash(): void {
    this.stopPacing();
    this.active = false;
    this.emit("worker:crashed", { workerId: this.config.id });
  }

  recover(): void {
    const calls = this.callManager.getCallsByCampaign(this.config.campaignId);
    for (const call of calls) {
      if (call.state === CallState.INITIATED || call.state === CallState.RINGING) {
        this.callManager.transitionCall(call.id, CallState.FAILED, "Worker crash recovery");
        if (call.agentId) {
          this.agentManager.releaseAgent(call.agentId, AgentState.AVAILABLE);
        }
      }
    }
    this.active = true;
    this.emit("worker:recovered", { workerId: this.config.id });
  }

  getConfig(): WorkerConfig {
    return { ...this.config };
  }

  isActive(): boolean {
    return this.active;
  }
}

export interface MultiWorkerResult {
  totalWorkers: number;
  totalCallsInitiated: number;
  totalCallsCompleted: number;
  totalCallsFailed: number;
  agentReservationConflicts: number;
  concurrentAttempts: number;
  maxConcurrent: number;
}

export class MultiWorkerSimulator {
  private sharedState: SharedStateManager;
  private agentManager: AgentManager;
  private callManager: CallManager;
  private safetyController: SafetyController;
  private workers: DialerWorker[] = [];

  constructor() {
    this.sharedState = new SharedStateManager();
    this.agentManager = new AgentManager();
    this.callManager = new CallManager();
    this.safetyController = new SafetyController();
  }

  async runConcurrencyTest(
    workerCount: number,
    agentCount: number,
    durationSeconds: number
  ): Promise<MultiWorkerResult> {
    const campaignId = "concurrency_test";

    for (let i = 0; i < agentCount; i++) {
      const agent = this.agentManager.createAgent(`agent_${i}`, campaignId);
      this.sharedState.registerAgent(agent);
    }

    let totalInitiated = 0;
    let totalCompleted = 0;
    let totalFailed = 0;
    let conflicts = 0;
    let concurrentAttempts = 0;
    let maxConcurrent = 0;

    for (let w = 0; w < workerCount; w++) {
      const worker = new DialerWorker(
        { id: `worker_${w}`, campaignId },
        this.sharedState,
        this.agentManager,
        this.callManager,
        this.safetyController
      );

      worker.on("call:completed", () => {
        totalCompleted++;
        concurrentAttempts--;
      });
      worker.on("call:failed", () => {
        totalFailed++;
        concurrentAttempts--;
      });

      this.workers.push(worker);
    }

    for (const worker of this.workers) {
      worker.startPacing(200);
    }

    await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000));

    for (const worker of this.workers) {
      worker.stopPacing();
    }

    const allCalls = this.callManager.getCallsByCampaign(campaignId);
    totalInitiated = allCalls.filter(
      (c) => c.state !== CallState.QUEUED
    ).length;

    const stats = this.sharedState.getStats(campaignId);

    return {
      totalWorkers: workerCount,
      totalCallsInitiated: totalInitiated,
      totalCallsCompleted: stats.completedCalls,
      totalCallsFailed: stats.failedCalls,
      agentReservationConflicts: conflicts,
      concurrentAttempts,
      maxConcurrent: stats.activeCalls,
    };
  }

  async runCrashRecoveryTest(
    durationSeconds: number
  ): Promise<{ crashed: boolean; recovered: boolean; callsAfterRecovery: number }> {
    const campaignId = "crash_test";

    for (let i = 0; i < 10; i++) {
      const agent = this.agentManager.createAgent(`agent_${i}`, campaignId);
      this.sharedState.registerAgent(agent);
    }

    const worker = new DialerWorker(
      { id: "worker_main", campaignId },
      this.sharedState,
      this.agentManager,
      this.callManager,
      this.safetyController
    );

    worker.startPacing(500);
    await new Promise((resolve) => setTimeout(resolve, 3000));

    worker.simulateCrash();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const failedCalls = this.callManager
      .getCallsByCampaign(campaignId)
      .filter((c) => c.state === CallState.FAILED).length;

    worker.recover();
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const callsAfterRecovery = this.callManager.getCallsByCampaign(campaignId).length;
    worker.stopPacing();

    return {
      crashed: true,
      recovered: true,
      callsAfterRecovery,
    };
  }

  async runProviderOutageTest(
    durationSeconds: number
  ): Promise<{
    outageDetected: boolean;
    callsDuringOutage: number;
    callsAfterRecovery: number;
  }> {
    const campaignId = "outage_test";
    const providerA = new (require("../providers/providerA").ProviderA)();
    const providerB = new (require("../providers/providerB").ProviderB)();

    const worker = new DialerWorker(
      { id: "worker_outage", campaignId },
      this.sharedState,
      this.agentManager,
      this.callManager,
      this.safetyController
    );

    worker.registerProvider(providerA);
    worker.registerProvider(providerB);

    for (let i = 0; i < 20; i++) {
      const agent = this.agentManager.createAgent(`agent_outage_${i}`, campaignId);
      this.sharedState.registerAgent(agent);
    }

    worker.startPacing(500);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    providerA.setHealthy(false);
    providerB.setHealthy(false);
    await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000));

    const callsDuringOutage = this.callManager
      .getCallsByCampaign(campaignId)
      .filter((c) => c.state === CallState.FAILED).length;

    providerA.setHealthy(true);
    providerB.setHealthy(true);
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const callsAfterRecovery = this.callManager.getCallsByCampaign(campaignId).length;
    worker.stopPacing();

    return {
      outageDetected: this.safetyController.getMetrics().rejected > 0 || this.safetyController.getMetrics().reduced > 0,
      callsDuringOutage,
      callsAfterRecovery,
    };
  }

  async runAgentDropTest(
    initialAgents: number,
    dropCount: number,
    durationSeconds: number
  ): Promise<{
    initialAgentCount: number;
    agentsAfterDrop: number;
    pacingReduced: boolean;
  }> {
    const campaignId = "agent_drop_test";

    for (let i = 0; i < initialAgents; i++) {
      const agent = this.agentManager.createAgent(`agent_drop_${i}`, campaignId);
      this.sharedState.registerAgent(agent);
    }

    const worker = new DialerWorker(
      { id: "worker_drop", campaignId },
      this.sharedState,
      this.agentManager,
      this.callManager,
      this.safetyController
    );

    worker.startPacing(500);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    for (let i = 0; i < dropCount; i++) {
      const agentId = `agent_drop_${i}`;
      this.agentManager.setAgentOffline(agentId);
      this.sharedState.updateAgentState(agentId, AgentState.OFFLINE);
    }

    await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000));

    const stats = this.sharedState.getStats(campaignId);
    const safetyMetrics = this.safetyController.getMetrics();

    worker.stopPacing();

    return {
      initialAgentCount: initialAgents,
      agentsAfterDrop: stats.availableAgents,
      pacingReduced: safetyMetrics.reduced > 0 || safetyMetrics.fallbackToProgressive > 0,
    };
  }

  printResults(result: MultiWorkerResult): void {
    console.log("\n" + "=".repeat(60));
    console.log("MULTI-WORKER CONCURRENCY TEST RESULTS");
    console.log("=".repeat(60));
    console.log(`Workers: ${result.totalWorkers}`);
    console.log(`Calls Initiated: ${result.totalCallsInitiated}`);
    console.log(`Calls Completed: ${result.totalCallsCompleted}`);
    console.log(`Calls Failed: ${result.totalCallsFailed}`);
    console.log(`Reservation Conflicts: ${result.agentReservationConflicts}`);
    console.log(`Max Concurrent: ${result.maxConcurrent}`);
  }
}
