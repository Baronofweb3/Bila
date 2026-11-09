import { type PolicyInput, type PreparedOwnerTx } from "./chain.js";
/**
 * Builders for owner-signed transactions. Nothing here signs or sends: loosening
 * actions need the owner's wallet (full-access key), so the MCP server can only
 * PREPARE them. The contract rejects them from any other key.
 */
export declare function prepareRegisterAgent(contractId: string, agentAccount: string, name: string, policy: PolicyInput, storageDepositYocto: bigint): PreparedOwnerTx;
export declare function prepareSetPolicy(contractId: string, agentId: string, policy: PolicyInput): PreparedOwnerTx;
export declare function prepareAgentState(contractId: string, kind: "pause_agent" | "resume_agent" | "revoke_agent", agentId: string): PreparedOwnerTx;
