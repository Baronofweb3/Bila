# BILA — build status

Deadline: **2026-11-14**

## Done (verified)
- [x] Repo scaffold, official logo in `docs/brand/` and `apps/dashboard/public/brand/` (unaltered). Brand blue sampled from logo: `#0700FE`.
- [x] `bila_core` contract: owners, restricted treasury, storage accounting, agent registry, policies, atomic reservations, async settlement + callbacks, idempotency, expiry, withdrawals, NEP-297 events, views, dry-run `check_payment`.
- [x] 35 unit tests passing (`cargo test`), covering all 14 mandatory scenarios plus extras.

- [x] `@bila/shared` (integer NEAR units, types, plain-language reject reasons) — 2 tests.
- [x] `@bila/near-client` (typed chain interface, near-api-js adapter, owner-tx preparers) — typechecks; **not run against a live RPC** (blocked in sandbox).
- [x] `@bila/mcp-server` (Streamable HTTP, bearer auth, role-scoped tools, AES-GCM key vault) — 10 tests: tool surface, agent isolation, owner scoping, 401s, token revocation.

## Not yet verified
- [ ] wasm build (`static.rust-lang.org` blocked in the dev sandbox → runs in GitHub Actions)
- [ ] Sandbox integration tests (near-workspaces) — real cross-contract receipts, `#[private]` wrapper, gas
- [ ] Testnet deployment

## Accounts
- GitHub: `baronofweb3/Bila` (created, empty). Testnet: `agentbilla.testnet`.

## Blockers
1. This session has no GitHub access to the repo (`add_repo` not granted) → cannot push or run CI.
2. Real chain calls from MCP (near-client) untested until testnet is reachable.

## Design decisions
- Units: yoctoNEAR integers; limits in NEAR. No oracle in MVP.
- Agent auth = NEAR account signature (`predecessor == agent.account`). MCP holds a **function-call key** limited to `request_payment` — it cannot transfer funds or attach deposits.
- Owner loosening actions require 1 yocto → wallet confirmation. MCP owner tools prepare a transaction for wallet signing; they never execute loosening actions themselves.
- Rejections return a structured outcome (no panic) so reasons reach the agent and indexer.
- Expired pending payments count as **spent** (protects other tenants); a late failure callback restores them.
- Contract has no admin. For production, remove full-access keys from the contract account after deploy.

## Known limitations / to harden
- Per-agent history is on-chain and grows; add owner-triggered pruning before mainnet.
- Agent account rotation = revoke + register new.
