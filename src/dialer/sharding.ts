import { EventEmitter } from "events";
import { DialerOrchestrator } from "./orchestrator";
import { TelecomProvider } from "../providers/types";

export interface ShardConfig {
  maxCampaignsPerShard: number;
  maxAgentsPerShard: number;
}

export interface ShardInfo {
  id: string;
  campaignIds: string[];
  agentCount: number;
  isActive: boolean;
}

export class ShardManager extends EventEmitter {
  private shards: Map<string, DialerOrchestrator> = new Map();
  private campaignToShard: Map<string, string> = new Map();
  private providers: TelecomProvider[] = [];
  private config: ShardConfig;

  constructor(config: Partial<ShardConfig> = {}) {
    super();
    this.config = {
      maxCampaignsPerShard: config.maxCampaignsPerShard || 10,
      maxAgentsPerShard: config.maxAgentsPerShard || 1000,
    };
  }

  registerProvider(provider: TelecomProvider): void {
    this.providers.push(provider);
    for (const [, orchestrator] of this.shards) {
      orchestrator.registerProvider(provider);
    }
  }

  createCampaign(config: {
    id: string;
    name: string;
    borrowerList: string[];
    mode: "progressive" | "predictive";
  }): { campaignId: string; shardId: string } {
    const shardId = this.selectShard();
    const orchestrator = this.shards.get(shardId);

    if (!orchestrator) {
      throw new Error(`Shard ${shardId} not found`);
    }

    orchestrator.createCampaign(config);
    this.campaignToShard.set(config.id, shardId);

    this.emit("campaign:created", {
      campaignId: config.id,
      shardId,
    });

    return { campaignId: config.id, shardId };
  }

  addAgent(agentId: string, campaignId: string): void {
    const shardId = this.campaignToShard.get(campaignId);
    if (!shardId) {
      throw new Error(`Campaign ${campaignId} not found in any shard`);
    }

    const orchestrator = this.shards.get(shardId);
    orchestrator?.addAgent(agentId, campaignId);
  }

  startPacing(campaignId: string, intervalMs: number = 1000): void {
    const shardId = this.campaignToShard.get(campaignId);
    if (!shardId) return;

    const orchestrator = this.shards.get(shardId);
    orchestrator?.startPacing(campaignId, intervalMs);
  }

  stopPacing(campaignId: string): void {
    const shardId = this.campaignToShard.get(campaignId);
    if (!shardId) return;

    const orchestrator = this.shards.get(shardId);
    orchestrator?.stopPacing(campaignId);
  }

  getShardForCampaign(campaignId: string): string | undefined {
    return this.campaignToShard.get(campaignId);
  }

  getShardInfo(): ShardInfo[] {
    const infos: ShardInfo[] = [];

    for (const [shardId, orchestrator] of this.shards) {
      const campaignIds = Array.from(this.campaignToShard.entries())
        .filter(([_, sid]) => sid === shardId)
        .map(([cid]) => cid);

      infos.push({
        id: shardId,
        campaignIds,
        agentCount: 0,
        isActive: true,
      });
    }

    return infos;
  }

  private selectShard(): string {
    if (this.shards.size === 0) {
      this.createShard("shard_1");
    }

    let bestShard = "";
    let lowestLoad = Infinity;

    for (const [shardId, orchestrator] of this.shards) {
      const campaignCount = Array.from(this.campaignToShard.values()).filter(
        (sid) => sid === shardId
      ).length;

      if (campaignCount < this.config.maxCampaignsPerShard) {
        if (campaignCount < lowestLoad) {
          lowestLoad = campaignCount;
          bestShard = shardId;
        }
      }
    }

    if (!bestShard) {
      const newShardId = `shard_${this.shards.size + 1}`;
      this.createShard(newShardId);
      bestShard = newShardId;
    }

    return bestShard;
  }

  private createShard(shardId: string): void {
    const orchestrator = new DialerOrchestrator(shardId);

    for (const provider of this.providers) {
      orchestrator.registerProvider(provider);
    }

    this.shards.set(shardId, orchestrator);

    this.emit("shard:created", { shardId });
  }

  async shutdown(): Promise<void> {
    for (const [, orchestrator] of this.shards) {
      await orchestrator.shutdown();
    }
    this.shards.clear();
    this.campaignToShard.clear();
  }
}
