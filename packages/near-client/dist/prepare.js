import { formatNear } from "@bila/shared";
import { toContractPolicy } from "./chain.js";
/**
 * Builders for owner-signed transactions. Nothing here signs or sends: loosening
 * actions need the owner's wallet (full-access key), so the MCP server can only
 * PREPARE them. The contract rejects them from any other key.
 */
export function prepareRegisterAgent(contractId, agentAccount, name, policy, storageDepositYocto) {
    return {
        kind: "register_agent", receiverId: contractId, methodName: "register_agent",
        args: { agent_account: agentAccount, name, policy: toContractPolicy(policy) },
        depositYocto: storageDepositYocto.toString(), gasTgas: 60,
        summary: `Register agent "${name}" (${agentAccount}); ${formatNear(storageDepositYocto)} NEAR goes to your storage balance.`,
    };
}
export function prepareSetPolicy(contractId, agentId, policy) {
    return {
        kind: "set_policy", receiverId: contractId, methodName: "set_policy",
        args: { agent_id: agentId, policy: toContractPolicy(policy) },
        depositYocto: "1", gasTgas: 30,
        summary: `Set agent ${agentId} limits: ${formatNear(policy.dailyYocto)}/day, ${formatNear(policy.weeklyYocto)}/week, ${formatNear(policy.monthlyYocto)}/month, max ${formatNear(policy.maxTxYocto)} per payment.`,
    };
}
export function prepareAgentState(contractId, kind, agentId) {
    return {
        kind, receiverId: contractId, methodName: kind, args: { agent_id: agentId },
        depositYocto: kind === "resume_agent" ? "1" : "0", gasTgas: 30,
        summary: `${kind.replace("_agent", "")} agent ${agentId}.`,
    };
}
