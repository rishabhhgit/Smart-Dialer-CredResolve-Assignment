export interface PersistenceRecord {
  id: string;
  type: "agent" | "call" | "campaign";
  data: Record<string, unknown>;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export class InMemoryDatabase {
  private records: Map<string, PersistenceRecord> = new Map();
  private WAL: Array<{ operation: string; recordId: string; timestamp: number }> = [];
  private snapshots: Map<string, Record<string, PersistenceRecord>> = new Map();

  save(type: "agent" | "call" | "campaign", id: string, data: Record<string, unknown>): void {
    const existing = this.records.get(id);
    const version = existing ? existing.version + 1 : 1;
    const now = Date.now();

    const record: PersistenceRecord = {
      id,
      type,
      data: { ...data },
      version,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.records.set(id, record);
    this.WAL.push({ operation: "save", recordId: id, timestamp: now });
  }

  load(id: string): PersistenceRecord | undefined {
    return this.records.get(id);
  }

  loadByType(type: "agent" | "call" | "campaign"): PersistenceRecord[] {
    return Array.from(this.records.values()).filter((r) => r.type === type);
  }

  delete(id: string): boolean {
    const existed = this.records.has(id);
    this.records.delete(id);
    if (existed) {
      this.WAL.push({ operation: "delete", recordId: id, timestamp: Date.now() });
    }
    return existed;
  }

  snapshot(snapshotName: string): void {
    const snapshot: Record<string, PersistenceRecord> = {};
    for (const [id, record] of this.records) {
      snapshot[id] = { ...record, data: { ...record.data } };
    }
    this.snapshots.set(snapshotName, snapshot);
  }

  restore(snapshotName: string): boolean {
    const snapshot = this.snapshots.get(snapshotName);
    if (!snapshot) return false;

    this.records.clear();
    for (const [id, record] of Object.entries(snapshot)) {
      this.records.set(id, { ...record, data: { ...record.data } });
    }
    return true;
  }

  getWAL(): Array<{ operation: string; recordId: string; timestamp: number }> {
    return [...this.WAL];
  }

  clearWAL(): void {
    this.WAL = [];
  }

  count(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
    this.WAL = [];
  }
}

export class CrashRecoveryManager {
  private db: InMemoryDatabase;
  private checkpointInterval: NodeJS.Timeout | null = null;

  constructor(db: InMemoryDatabase) {
    this.db = db;
  }

  startAutoCheckpoint(intervalMs: number = 30000): void {
    this.checkpointInterval = setInterval(() => {
      this.checkpoint();
    }, intervalMs);
  }

  stopAutoCheckpoint(): void {
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
      this.checkpointInterval = null;
    }
  }

  checkpoint(): void {
    const snapshotName = `checkpoint_${Date.now()}`;
    this.db.snapshot(snapshotName);
    this.db.clearWAL();
  }

  recoverFromCrash(): {
    recovered: boolean;
    recordsRecovered: number;
    pendingOperations: number;
  } {
    const wal = this.db.getWAL();
    const pendingOperations = wal.length;

    const snapshots = Array.from(this.db.loadByType("campaign"));
    const recovered = snapshots.length > 0;

    return {
      recovered,
      recordsRecovered: this.db.count(),
      pendingOperations,
    };
  }

  saveAgentState(agentId: string, state: Record<string, unknown>): void {
    this.db.save("agent", agentId, state);
  }

  saveCallState(callId: string, state: Record<string, unknown>): void {
    this.db.save("call", callId, state);
  }

  saveCampaignState(campaignId: string, state: Record<string, unknown>): void {
    this.db.save("campaign", campaignId, state);
  }

  getAgentState(agentId: string): Record<string, unknown> | undefined {
    return this.db.load(agentId)?.data;
  }

  getCallState(callId: string): Record<string, unknown> | undefined {
    return this.db.load(callId)?.data;
  }
}
