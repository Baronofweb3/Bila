import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type BilaChain } from "@bila/near-client";
import type { Principal } from "./auth.js";
export interface ToolDeps {
    chain: BilaChain;
    contractId: string;
    /** Default storage deposit attached to register_agent (yocto). */
    registerStorageYocto: bigint;
}
/**
 * Builds a server exposing ONLY the tools the authenticated principal may use.
 * Agent identity always comes from the credential, never from tool arguments.
 * There is deliberately no authorize/settle/withdraw tool: the contract decides.
 */
export declare function createBilaServer(principal: Principal, deps: ToolDeps): McpServer;
