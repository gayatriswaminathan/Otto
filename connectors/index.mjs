// connectors/index.mjs
// Connector registry + multi-source loader.
//
// CONNECTORS maps a source name → its real `fetchProgramState(opts)`.
// The worker decides live-vs-fixture (e.g. swap in `<source>.fixture.mjs`);
// this registry always wires the REAL connectors.
//
// loadSources(specs, env) fetches each requested source and merges the results
// into a single ProgramState via core/program_state.mjs#mergeStates.

import { fetchProgramState as jira } from "./jira.mjs";
import { fetchProgramState as slack } from "./slack.mjs";
import { fetchProgramState as confluence } from "./confluence.mjs";
import { fetchProgramState as notion } from "./notion.mjs";
import { mergeStates } from "../core/program_state.mjs";

// Structured connectors (linear, github) are built in parallel; import them
// lazily so the registry stays loadable even if a module isn't present yet.
// Each resolves to a real fetchProgramState or a clear "not implemented" stub.
const linear = lazy("./linear.mjs", "linear");
const github = lazy("./github.mjs", "github");

/**
 * The connector registry. Keys are source names; values are the connector's
 * `fetchProgramState(opts) -> Promise<ProgramState>`.
 */
export const CONNECTORS = { jira, linear, github, slack, confluence, notion };

/**
 * Fetch many sources and merge them into one ProgramState.
 *
 * @param {Array<{source:string, opts?:object}>} specs - sources to load.
 * @param {object} [env] - Worker env; opts may reference secrets the caller injects.
 * @returns {Promise<object>} a single merged ProgramState.
 */
export async function loadSources(specs, env = {}) {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error("loadSources: `specs` must be a non-empty array of { source, opts }");
  }

  const states = [];
  for (const spec of specs) {
    const fetchFn = CONNECTORS[spec?.source];
    if (typeof fetchFn !== "function") {
      throw new Error(`loadSources: unknown source "${spec?.source}"`);
    }
    states.push(await fetchFn(spec.opts || {}, env));
  }

  return mergeStates(states);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a lazy connector fn for a module that may not exist yet. The returned
 * function imports the module on first call and delegates to its
 * fetchProgramState; if the module is missing, it throws a clear error.
 */
function lazy(specifier, name) {
  return async function fetchProgramState(opts, env) {
    let mod;
    try {
      mod = await import(specifier);
    } catch {
      throw new Error(`connector "${name}" is not available yet (${specifier} not found)`);
    }
    if (typeof mod.fetchProgramState !== "function") {
      throw new Error(`connector "${name}" has no fetchProgramState export`);
    }
    return mod.fetchProgramState(opts, env);
  };
}
