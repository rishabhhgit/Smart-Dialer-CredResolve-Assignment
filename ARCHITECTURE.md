# Architecture Decision Document

## SmartDialer - Technical Decisions

### 1. Language Choice: TypeScript + Node.js

**Decision:** TypeScript running on Node.js

**Why:**
- Event-driven, non-blocking I/O is ideal for call orchestration (many concurrent async operations)
- Strong typing catches state machine errors at compile time
- Fast prototyping with good async/await support
- Single process is appropriate for prototype scale (up to ~1000 agents)

**Trade-offs:**
- Single-threaded event loop limits CPU-bound work (not an issue here - I/O bound)
- No built-in distributed state (solved with architecture, not technology)
- Would use Go or Java for true distributed deployment at 10K+ agents

---

### 2. State Machine Architecture

**Decision:** Explicit state machines for both Agent and Call lifecycle

**Agent States:**
```
OFFLINE → AVAILABLE → RESERVED → DIALING → CONNECTED → WRAP_UP → AVAILABLE
```

**Call States:**
```
QUEUED → RESERVED → INITIATED → RINGING → ANSWERED → CONNECTED → COMPLETED
                                                         ↓
                                                      FAILED/CANCELLED
```

**Why:**
- Prevents invalid state transitions (e.g., CONNECTED → RESERVED)
- Every transition is validated against allowed transitions
- Full state history provides audit trail
- Makes failure scenarios explicit and testable

**Implementation:**
- `VALID_TRANSITIONS` maps define allowed transitions
- Every state change goes through `transitionState()` which validates
- State history array tracks all transitions with timestamps

---

### 3. Safety Controller Placement

**Decision:** Safety Controller sits BETWEEN pacing engine and call initiation

```
Campaign → Pacing Engine → Safety Controller → Call Allocator → Provider
```

**Why:**
- Pacing engine cannot bypass safety checks
- Safety Controller has full context (agent availability, provider health, failure rates)
- Can approve, reduce, reject, or force fallback to progressive
- Clear separation of concerns

**Safety Rules (in order):**
1. Provider health check - reject if providers unhealthy and few agents
2. Utilization check - fallback to progressive if connected/active ratio too low
3. Agent capacity - never exceed available agents
4. Answer rate margin - reduce when answer rate is low
5. Ringing cap - prevent too many simultaneous rings

**Key Property:** Pacing engine has NO direct path to place calls. Safety Controller is the only gate.

---

### 4. Concurrency Model: Async Locks

**Decision:** Per-agent async locks with version numbers

**Why:**
- Prevents two workers from reserving the same agent simultaneously
- Lock granularity: one lock per agent (not per campaign)
- Version numbers detect stale reads

**How it works:**
```
Worker A: acquireLock(agent_1) → reserve(agent_1) → releaseLock(agent_1)
Worker B: acquireLock(agent_1) → find agent RESERVED → skip → try agent_2
```

**Implementation:**
- `locks: Map<string, Promise<void>>` tracks active locks
- `acquireLock()` waits for existing lock, then creates new one
- `tryReserveAgent()` in SharedStateManager provides distributed-safe version

---

### 5. Multi-Worker Concurrency

**Decision:** Simulated shared state manager for multi-worker testing

**Architecture:**
```
┌─────────────────────────────────────────────────┐
│              SharedStateManager                  │
│  - Centralized agent/call state                  │
│  - Per-agent locking with version numbers        │
│  - Optimistic concurrency control                │
├─────────────┬─────────────┬─────────────────────┤
│   Worker 1  │   Worker 2  │      Worker N       │
│  (pacing)   │  (pacing)   │     (pacing)        │
└─────────────┴─────────────┴─────────────────────┘
```

**Conflict Resolution:**
1. Worker A acquires lock on agent_1
2. Worker B tries to acquire lock, waits
3. Worker A reserves agent_1, releases lock
4. Worker B acquires lock, finds agent RESERVED, picks agent_2

**Why not Redis/Kafka:**
- Prototype scope doesn't require external dependencies
- In-memory locks demonstrate the concurrency pattern
- Production would use Redis Redlock or similar

---

### 6. Provider Abstraction

**Decision:** Common `TelecomProvider` interface with multiple implementations

**Interface:**
```typescript
interface TelecomProvider {
  initiateCall(request): Promise<{ providerCallId }>;
  hangupCall(providerCallId): Promise<void>;
  onEvent(callback): void;
  isHealthy: boolean;
}
```

**Two Mock Providers:**
- **ProviderA:** Fast, reliable, 85% answer rate
- **ProviderB:** Slower, failures, duplicates, out-of-order events

**Why:**
- Dialer doesn't know provider internals
- Can swap providers without changing dialer logic
- Tests provider chaos handling (duplicates, out-of-order, timeouts)

---

### 7. Predictive Algorithm

**Decision:** Erlang-C inspired with safety margins

**Calculation:**
1. Calculate traffic intensity: `agents * answerRate / avgDuration`
2. Compute Erlang-C waiting probability
3. Target occupancy: `min(0.85, answerRate * 1.15)`
4. Base dials: `agents * targetOccupancy * (1/answerRate)`
5. Apply safety margin based on:
   - Historical answer rate
   - Current ringing calls
   - Agent utilization ratio
   - Recent failure rate

**Safety Margins:**
- Low answer rate (<30%): 50% reduction
- High ringing (>40% of agents): 40% reduction
- High utilization (>90%): 70% reduction
- High recent failures (>50%): 60% reduction

---

### 8. Failure Handling

**Worker Crash Recovery:**
- Calls in INITIATED/RINGING state are marked FAILED
- Agents reserved for those calls are released to AVAILABLE
- On restart, system identifies orphaned calls and cleans up

**Provider Outage:**
- Safety Controller detects unhealthy providers
- Reduces or stops new call initiation
- Existing calls continue until completion/timeout
- When provider recovers, pacing resumes normally

**Agent Availability Drops:**
- Pacing engine recalculates on every cycle (500ms-1s)
- Available agent count drops → fewer calls initiated
- Safety Controller further reduces if utilization too high
- System reacts within 1-2 pacing cycles (0.5-2 seconds)

**Duplicate Events:**
- State history tracking prevents double-transitions
- Time-window deduplication (100ms window)
- State machine rejects invalid transitions

**Out-of-Order Events:**
- State machine validates every transition
- ANSWERED after COMPLETED is rejected
- RINGING after ANSWERED is rejected
- System remains in last valid state

---

### 9. Scalability Analysis

**Current Limitations (Single Process):**

| Bottleneck | Breaking Point | Fix |
|------------|----------------|-----|
| Memory (in-memory state) | ~50K agents | Redis sharding by campaign |
| Event loop | ~5K concurrent calls | Worker pool for event processing |
| Lock contention | ~1K agents | Distributed locks (Redlock) |
| Provider connections | Provider limits | Connection pooling |

**Scale Path:**
- **Phase 1 (1K agents):** Add Redis for agent state
- **Phase 2 (5K agents):** Shard by campaign, each gets own orchestrator
- **Phase 3 (10K+ agents):** Event-driven architecture with Kafka

---

### 10. Testing Strategy

**Unit Tests:**
- Agent state machine (8 tests)
- Call state machine (7 tests)
- Safety controller (5 tests)
- Total: 21 tests

**Integration Tests:**
- Multi-worker concurrency simulation
- Crash recovery scenario
- Provider outage scenario
- Agent availability drop scenario

**Load Tests:**
- 50, 200, 500 agents in progressive and predictive modes
- Metrics: calls/second, utilization, max concurrent, safety decisions

---

### Key Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript/Node.js | Async I/O, fast prototyping |
| State | In-memory Maps | Prototype simplicity, would use Redis at scale |
| Concurrency | Async locks | Prevents double-booking, simple to reason about |
| Safety | Separate controller | Cannot be bypassed by pacing engine |
| Providers | Interface abstraction | Swap providers without changing dialer |
| Algorithm | Erlang-C + safety margins | Industry-standard with conservative adjustments |

---

### What I Would Do Differently With More Time

1. **Database persistence** - Survive restarts, audit trail
2. **Message queue** - Kafka/RabbitMQ for provider events
3. **Distributed locks** - Redis Redlock for multi-process
4. **Campaign sharding** - Each campaign isolated
5. **Real-time dashboard** - WebSocket metrics
6. **A/B testing** - Compare pacing algorithms in production
7. **Machine learning** - Answer rate prediction from call patterns
