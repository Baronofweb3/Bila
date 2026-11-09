import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { REJECT_EXPLANATIONS, formatNear, parseNear } from "@bila/shared";
import { prepareAgentState, prepareRegisterAgent, prepareSetPolicy, } from "@bila/near-client";
const nearAmount = z.string().describe('Amount in NEAR as a plain decimal string, e.g. "2.5"');
const accountId = z.string().min(2).max(64).regex(/^[a-z0-9._-]+$/, "invalid NEAR account id");
const requestId = z.string().min(1).max(64).regex(/^[A-Za-z0-9\-_:.]+$/);
const text = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 2) }] });
const fail = (msg) => ({ isError: true, content: [{ type: "text", text: msg }] });
const why = (r) => (r ? REJECT_EXPLANATIONS[r] : undefined);
function budgetSummary(a) {
    const b = a.budget;
    return {
        agent_id: a.id, name: a.name, account: a.account, status: a.status,
        limits_near: {
            per_payment: formatNear(a.policy.max_transaction), daily: formatNear(a.policy.daily_limit),
            weekly: formatNear(a.policy.weekly_limit), monthly: formatNear(a.policy.monthly_limit),
        },
        remaining_near: {
            today: formatNear(b.remaining_today), this_week: formatNear(b.remaining_this_week),
            this_month: formatNear(b.remaining_this_month),
        },
        spendable_now_near: formatNear(b.spendable_now),
        recipients: a.policy.allowed_recipients ?? "any",
    };
}
function policyShape() {
    return {
        daily_near: nearAmount, weekly_near: nearAmount, monthly_near: nearAmount, max_per_payment_near: nearAmount,
        allowed_recipients: z.array(accountId).max(50).optional().describe("Omit for any recipient"),
    };
}
function toPolicy(i) {
    return {
        dailyYocto: parseNear(i.daily_near), weeklyYocto: parseNear(i.weekly_near),
        monthlyYocto: parseNear(i.monthly_near), maxTxYocto: parseNear(i.max_per_payment_near),
        allowedRecipients: i.allowed_recipients?.length ? i.allowed_recipients : null,
    };
}
/**
 * Builds a server exposing ONLY the tools the authenticated principal may use.
 * Agent identity always comes from the credential, never from tool arguments.
 * There is deliberately no authorize/settle/withdraw tool: the contract decides.
 */
export function createBilaServer(principal, deps) {
    const server = new McpServer({ name: "bila", version: "0.1.0" });
    const { chain } = deps;
    const ownedAgent = async (owner, agentId) => {
        const a = await chain.getAgent(agentId);
        return a && a.owner === owner ? a : null; // not-yours looks identical to not-found
    };
    if (principal.role === "agent") {
        const me = () => chain.getAgentByAccount(principal.agentAccount);
        server.registerTool("get_agent_status", {
            title: "My status and budget",
            description: "Your own status, limits and remaining budget. Read-only.",
            annotations: { readOnlyHint: true },
        }, async () => {
            const a = await me();
            return a ? text(budgetSummary(a)) : fail(REJECT_EXPLANATIONS.unregistered_agent);
        });
        server.registerTool("check_budget", {
            title: "Check a payment before sending",
            description: "Free dry-run: would this payment be allowed right now, and why or why not. Does not move money.",
            inputSchema: { recipient: accountId, amount_near: nearAmount },
            annotations: { readOnlyHint: true },
        }, async ({ recipient, amount_near }) => {
            const a = await me();
            if (!a)
                return fail(REJECT_EXPLANATIONS.unregistered_agent);
            const r = await chain.checkPayment(a.id, recipient, parseNear(amount_near));
            return text({ allowed: r.allowed, reason: r.reason, explanation: why(r.reason), ...budgetSummary(a) });
        });
        server.registerTool("request_payment", {
            title: "Request a payment",
            description: "Ask BILA to pay a recipient from your owner's restricted treasury. The on-chain contract approves or rejects it " +
                "against your limits; you cannot override a rejection. Use a unique request_id per payment and reuse the SAME " +
                "request_id when retrying so you are never paid twice.",
            inputSchema: { request_id: requestId, recipient: accountId, amount_near: nearAmount, memo: z.string().max(140).optional() },
        }, async ({ request_id, recipient, amount_near, memo }) => {
            let amount;
            try {
                amount = parseNear(amount_near);
            }
            catch (e) {
                return fail(e.message);
            }
            const out = await chain.requestPayment(principal.agentAccount, {
                requestId: request_id, recipient, amountYocto: amount, ...(memo ? { memo } : {}),
            });
            return text({ ...out, amount_near: formatNear(out.amount), explanation: why(out.reason) });
        });
        server.registerTool("get_transaction_history", {
            title: "My recent payments",
            description: "Your most recent payment requests, newest first.",
            inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
            annotations: { readOnlyHint: true },
        }, async ({ limit }) => {
            const a = await me();
            if (!a)
                return fail(REJECT_EXPLANATIONS.unregistered_agent);
            const rows = await chain.listAgentPayments(a.id, 0, limit);
            return text(rows.map((p) => ({ ...p, amount_near: formatNear(p.amount) })));
        });
        return server;
    }
    // ---------------- owner ----------------
    const { owner } = principal;
    const prepared = (tx) => text({
        needs_wallet_signature: true,
        note: "Nothing was executed. Open the BILA dashboard and approve this transaction in your wallet.",
        transaction: tx,
    });
    server.registerTool("register_agent", {
        title: "Register an agent (prepare)",
        description: "Prepare an owner-signed transaction that registers an agent account with spending limits.",
        inputSchema: { agent_account: accountId, name: z.string().min(1).max(48), ...policyShape() },
    }, async (i) => {
        try {
            return prepared(prepareRegisterAgent(deps.contractId, i.agent_account, i.name, toPolicy(i), deps.registerStorageYocto));
        }
        catch (e) {
            return fail(e.message);
        }
    });
    server.registerTool("set_budget", {
        title: "Change an agent's limits (prepare)",
        description: "Prepare an owner-signed transaction replacing an agent's limits. Agents can never do this themselves.",
        inputSchema: { agent_id: z.string().regex(/^\d+$/), ...policyShape() },
    }, async (i) => {
        if (!(await ownedAgent(owner, i.agent_id)))
            return fail("Agent not found for this owner.");
        try {
            return prepared(prepareSetPolicy(deps.contractId, i.agent_id, toPolicy(i)));
        }
        catch (e) {
            return fail(e.message);
        }
    });
    for (const kind of ["pause_agent", "resume_agent"]) {
        server.registerTool(kind, {
            title: `${kind === "pause_agent" ? "Pause" : "Resume"} an agent (prepare)`,
            description: kind === "pause_agent"
                ? "Prepare a transaction that blocks all payments from the agent until resumed."
                : "Prepare a transaction that lets a paused agent spend again (needs your full-access key).",
            inputSchema: { agent_id: z.string().regex(/^\d+$/) },
        }, async ({ agent_id }) => {
            if (!(await ownedAgent(owner, agent_id)))
                return fail("Agent not found for this owner.");
            return prepared(prepareAgentState(deps.contractId, kind, agent_id));
        });
    }
    server.registerTool("get_agent_status", {
        title: "Agent status and budget",
        description: "Status, limits and remaining budget for one of your agents, or all of them if agent_id is omitted.",
        inputSchema: { agent_id: z.string().regex(/^\d+$/).optional() },
        annotations: { readOnlyHint: true },
    }, async ({ agent_id }) => {
        if (agent_id) {
            const a = await ownedAgent(owner, agent_id);
            return a ? text(budgetSummary(a)) : fail("Agent not found for this owner.");
        }
        return text((await chain.listAgents(owner)).map(budgetSummary));
    });
    server.registerTool("check_budget", {
        title: "Check a payment for an agent",
        description: "Free dry-run of the contract's policy check for one of your agents.",
        inputSchema: { agent_id: z.string().regex(/^\d+$/), recipient: accountId, amount_near: nearAmount },
        annotations: { readOnlyHint: true },
    }, async ({ agent_id, recipient, amount_near }) => {
        const a = await ownedAgent(owner, agent_id);
        if (!a)
            return fail("Agent not found for this owner.");
        const r = await chain.checkPayment(a.id, recipient, parseNear(amount_near));
        return text({ allowed: r.allowed, reason: r.reason, explanation: why(r.reason) });
    });
    server.registerTool("get_transaction_history", {
        title: "Agent payment history",
        description: "Recent payments for one of your agents, newest first.",
        inputSchema: { agent_id: z.string().regex(/^\d+$/), limit: z.number().int().min(1).max(50).default(10) },
        annotations: { readOnlyHint: true },
    }, async ({ agent_id, limit }) => {
        const a = await ownedAgent(owner, agent_id);
        if (!a)
            return fail("Agent not found for this owner.");
        const rows = await chain.listAgentPayments(a.id, 0, limit);
        return text(rows.map((p) => ({ ...p, amount_near: formatNear(p.amount) })));
    });
    return server;
}
