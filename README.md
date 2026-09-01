# SmartDialer

A call center dialer that connects agents to borrowers efficiently while preventing abandoned calls.

## Tech Stack

| Tech | Why |
|------|-----|
| TypeScript | Type safety, catches state machine errors at compile time |
| Node.js | Event-driven, handles many concurrent async calls |
| Jest | Fast tests, built-in mocking, good TypeScript support |

**Why not Go/Python/Java?**
- Go: Overkill for prototype, would use at true distributed scale
- Python: Weaker async story, less type safety
- Java: Too much boilerplate for 4-6 hour assignment

**Why in-memory?**
- Prototype simplicity, would use Redis/Postgres at scale

## Setup

```bash
npm install
npm test
```

## Run

```bash
npm run start:demo           # 20-second demo
npm run start:simulate       # 6 scenarios
npm run start:multiworker    # Concurrency test
npm run start:failures       # Failure scenarios
npm run start:all            # Everything
```

## Architecture

```
Campaign → Pacing Engine → Safety Controller → Call Allocator → Provider
```

- **Pacing Engine** — decides how many calls to make (progressive or predictive)
- **Safety Controller** — cannot be bypassed, approves/reduces/rejects requests
- **Call Allocator** — matches agents to calls with locking
- **Providers** — ProviderA (fast), ProviderB (chaotic: duplicates, out-of-order, failures)

## Agent State Machine

```
OFFLINE → AVAILABLE → RESERVED → DIALING → CONNECTED → WRAP_UP → AVAILABLE
```

## Call State Machine

```
QUEUED → RESERVED → INITIATED → RINGING → ANSWERED → CONNECTED → COMPLETED
                                                         ↓
                                                      FAILED/CANCELLED
```

## Concurrency

Two workers can't reserve the same agent. Implemented via async locks — worker acquires lock, reserves agent, releases lock. Second worker finds agent already reserved and picks another.

## Failure Handling

| Scenario | Handling |
|----------|----------|
| Worker crash | Calls in INITIATED/RINGING marked FAILED, agents released |
| Provider outage | Safety controller detects, stops new calls |
| Agent drops | Pacing recalculates within 1-2 cycles (0.5-2s) |
| Duplicate events | Time-window dedup (100ms), state machine rejects |
| Out-of-order events | State machine validates every transition |

## Scale Bottlenecks

| Breaking Point | Fix |
|----------------|-----|
| ~50K agents (memory) | Redis sharding by campaign |
| ~5K concurrent calls (event loop) | Worker pool for events |
| ~1K agents (lock contention) | Distributed locks (Redlock) |
| Provider limits | Connection pooling |

## Test

```bash
npm test    # 55 tests, all passing
```

- Agent state machine (8 tests)
- Call state machine (7 tests)
- Safety controller (5 tests)
- Concurrency & edge cases (24 tests)
- Performance benchmarks (11 tests)
