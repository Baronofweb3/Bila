import { type Server } from "node:http";
import { type CredentialStore } from "./auth.js";
import { type ToolDeps } from "./tools.js";
/** Stateless Streamable HTTP endpoint at /mcp. Every request is authenticated. */
export declare function createHttpServer(store: CredentialStore, deps: ToolDeps): Server;
