#!/usr/bin/env node
/** `rugby-mcp`: the RuGBy MCP server over stdio. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const server = createServer();
await server.connect(new StdioServerTransport());
