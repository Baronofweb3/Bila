<p align="center"><img src="docs/brand/bila-logo.jpg" width="96" alt="BILA"></p>

# BILA

**Your agents. Your money. Your rules.**

BILA is financial governance and payment settlement for AI agents on NEAR. An owner funds a restricted treasury, registers an agent, and sets programmable limits. The `bila_core` contract enforces those limits before any payment settles — independently of the AI model, the MCP server or any backend database.

> Scope: BILA only controls funds held in its treasury and payments routed through it. It cannot police wallets or accounts it does not control.

## How enforcement works

| Rule | Enforced by |
|---|---|
| Only a registered, active agent can spend (caller == agent account) | contract |
| Per-transaction, daily, weekly, monthly limits (UTC; week = Mon–Sun) | contract |
| Amount reserved against every limit at request time (no concurrent overspend) | contract |
| Optional recipient allowlist; never to the agent itself or the contract | contract |
| Owner withdraws only unreserved funds | contract |
| Loosening (register, set policy, resume, withdraw) needs a full-access key (1 yoctoNEAR) | contract |
| Pause / revoke work without a deposit (emergency switch) | contract |
| Same `request_id` never pays twice | contract |
| Failed transfer releases its reservation; unconfirmed one expires conservatively | contract |

All amounts are integer yoctoNEAR. The MVP denominates limits in **NEAR** — no price oracle.

## Repository

```
contracts/bila-core   Rust contract (near-sdk 5.30) + unit tests
packages/mcp-server   MCP server (TypeScript)            — Phase 4
packages/near-client  Typed contract client              — Phase 4
apps/dashboard        Next.js dashboard                  — Phase 5
docs/                 Architecture, status, brand
```

## Contract quickstart

```bash
cd contracts/bila-core
cargo test                                 # runs the enforcement suite
cargo near build non-reproducible-wasm     # needs wasm32 target (CI does this)
```

See [docs/STATUS.md](docs/STATUS.md) for progress and blockers.
