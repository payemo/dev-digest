import * as api from '../api.js';
import { fromFailure } from '../errors.js';
import { formatAgents, toResult } from '../format.js';
import { defineTool } from './types.js';

/**
 * Zero arguments, deliberately: this is where an agent learns a valid `agent`
 * value for run_agent_on_pr, so calling it must cost nothing and never fail
 * for want of an argument.
 */
export default defineTool({
  name: 'list_agents',
  title: 'List reviewer agents',
  description:
    'List the DevDigest reviewer agents configured in this workspace, with the model each uses and whether it is enabled. Call this to get a valid agent name for run_agent_on_pr. Takes no arguments. Read-only.',
  shape: {},
  readOnly: true,
  handler: async () => {
    const res = await api.listAgents();
    if (!res.ok) return fromFailure(res.failure);
    return toResult({ agents: formatAgents(res.data) });
  },
});
