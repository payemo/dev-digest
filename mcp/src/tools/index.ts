import getBlastRadius from './get-blast-radius.js';
import getConventions from './get-conventions.js';
import getFindings from './get-findings.js';
import listAgents from './list-agents.js';
import runAgentOnPr from './run-agent-on-pr.js';
import type { ToolDef } from './types.js';

/**
 * The single registration point. `server.ts` iterates this to register tools;
 * the token-budget test iterates it to measure what a client pays to load them.
 *
 * Five tools is the whole surface. Every extra tool is paid for in every
 * request that never uses it, and tool-selection accuracy falls as the list
 * grows — so a new one earns its place, it does not simply get added.
 */
export const TOOLS: readonly ToolDef[] = [
  listAgents,
  runAgentOnPr,
  getFindings,
  getConventions,
  getBlastRadius,
];
