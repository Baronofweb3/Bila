# BILA — build status

Deadline: **2026-11-14**

## Done (verified)
- [x] Repo scaffold, official logo in `docs/brand/` and `apps/dashboard/public/brand/` (unaltered). Brand blue sampled from logo: `#0700FE`.
- [x] `bila_core` contract: owners, restricted treasury, storage accounting, agent registry, policies, atomic reservations, async settlement + callbacks, idempotency, expiry, withdrawals, NEP-297 events, views, dry-run `check_payment`.
- [x] 35 unit tests passing (`cargo test`), covering all 14 mandatory scenarios plus extras.

- [x] `@bila/shared` (integer NEAR units, types, plain-language reject reasons) — 2 tests.
- [x] `@bila/near-client` (typed chain interface, near-api-js adapter, owner-tx preparers) — typechecks; **not run against a live RPC** (blocked in sandbox).
- [x] `@bila/mcp-server` (Streamable HTTP, bearer auth, role-scoped tools, AES-GCM key vault) — 10 tests: tool surface, agent isolation, owner scoping, 401s, token revocation.

## Verified live on NEAR testnet (2026-11-09, neutral accounts)
- [x] Contract `bila-treasury-01.testnet`, owner `bila-owner-01.testnet`, agent `bila-agent-01.testnet`
- [x] Owner deposit, agent registered with a function-call key limited to `request_payment`
- [x] Hosted MCP endpoint on Vercel used from Claude as a custom connector (budget check, payments, history)
- [x] 2 payments of 0.2 NEAR settled; receipt confirmed in recipient wallet via NearBlocks (Receipts tab)
- [x] 0.9 NEAR vs 0.5 cap rejected: `exceeds_max_transaction`
- [x] Dashboard live at https://bila-psi.vercel.app (treasury, settled, blocked counts match chain)

## Not yet verified
- [ ] Sandbox integration tests (near-workspaces)
- [ ] Live: daily/weekly/monthly caps, duplicate id, pause/revoke, withdraw of reserved funds (unit-tested only)
- [ ] ChatGPT connector (depends on plan)

## Notes
- The demo agent token sits in the connector URL. Rotate it after the hackathon.

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
