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
packages/mcp-server   MCP server (TypeScript, Streamable HTTP)
packages/near-client  Typed contract client
apps/dashboard        Next.js dashboard (live read from the contract)
docs/                 Architecture, status, brand
```

## Contract quickstart

```bash
cd contracts/bila-core
cargo test                                 # runs the enforcement suite
cargo near build non-reproducible-wasm     # needs wasm32 target (CI does this)
```

## Live demo (NEAR testnet)

- Dashboard: https://bila-psi.vercel.app
- Contract: `bila-treasury-01.testnet`
- Agent connects to BILA through MCP, so Claude (or any MCP client) can use it as a custom connector. Steps: [docs/CONNECT.md](docs/CONNECT.md)

What was run end to end with Claude as the agent:

| Request | Result |
|---|---|
| Check budget | Limits and remaining balance returned from the contract |
| Pay 0.2 NEAR | Reserved, then settled on chain |
| Pay 0.2 NEAR again | Settled (new request id) |
| Pay 0.9 NEAR (cap is 0.5) | Rejected by the contract: `exceeds_max_transaction` |

The agent holds a function-call key that can only call `request_payment`. It cannot move funds on its own, attach a deposit, or change its own limits.

More: [Architecture](docs/ARCHITECTURE.md) · [Status and limits](docs/STATUS.md)
