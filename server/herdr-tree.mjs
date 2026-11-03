import { execFile } from 'node:child_process';
import { parseAgents, parseRunningSessions } from './herdr-sessions.mjs';

// Read-only snapshot of herdr's own sidebar: running local sessions plus enabled saved
// machines, each with its workspaces (spaces), branch and agents. Never throws.
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_MACHINES = 100;
const MAX_WORKSPACES = 500;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@:-]{0,99}$/;
const STATUSES = new Set(['idle', 'working', 'blocked', 'done', 'unknown']);

function parseJson(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_OUTPUT_BYTES) return null;
  try { return JSON.parse(output); } catch { return null; }
}

function text(value, maximum) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && ![...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127) ? value : null;
}

// `herdr machine list`: id \t name \t ssh target \t session \t enabled|disabled
export function parseMachines(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_OUTPUT_BYTES) return [];
  const machines = [];
  for (const line of output.split('\n').slice(0, MAX_MACHINES)) {
    const fields = line.split('\t');
    if (fields.length < 5 || fields[4].trim() !== 'enabled') continue;
    const name = fields[1].trim();
    if (!NAME_PATTERN.test(name) || machines.some((machine) => machine.name === name)) continue;
    machines.push({ id: fields[0].trim(), name, target: fields[2].trim(), session: fields[3].trim() });
  }
  return machines;
}

// `herdr workspace list` -> null when the output is not a workspace list (unreachable).
export function parseWorkspaces(output) {
  const list = parseJson(output)?.result?.workspaces;
  if (!Array.isArray(list)) return null;
  const workspaces = [];
  for (const item of list.slice(0, MAX_WORKSPACES)) {
    const id = text(item?.workspace_id, 100);
    if (!id) continue;
    const status = text(item.agent_status, 40);
    workspaces.push({
      id,
      label: text(item.label, 200) ?? id,
      status: status && STATUSES.has(status) ? status : 'unknown',
      checkoutPath: text(item.worktree?.checkout_path, 4096),
      repoKey: text(item.worktree?.repo_key, 4096),
      linked: item.worktree?.is_linked_worktree === true,
    });
  }
  return workspaces;
}

// `herdr worktree list --workspace ID` -> Map<path, branch>
export function parseWorktreeBranches(output) {
  const list = parseJson(output)?.result?.worktrees;
  const branches = new Map();
  if (!Array.isArray(list)) return branches;
  for (const item of list.slice(0, MAX_WORKSPACES)) {
    const path = text(item?.path, 4096);
    const branch = item?.is_detached ? 'detached' : text(item?.branch, 300);
    if (path && branch) branches.set(path, branch);
  }
  return branches;
}

// Branch of the checkout that contains `cwd` (exact path, else the longest parent path).
export function branchForCwd(output, cwd) {
  const branches = parseWorktreeBranches(output);
  let best = null;
  for (const [path, branch] of branches) {
    if ((cwd === path || cwd.startsWith(`${path}/`)) && (!best || path.length > best.path.length)) best = { path, branch };
  }
  return best?.branch ?? null;
}

export function parseTreeAgents(output) {
  const value = parseJson(output)?.result?.agents;
  if (!Array.isArray(value)) return new Map();
  const byWorkspace = new Map();
  const withIds = new Map(parseAgents(output).map((agent) => [agent.paneId, agent]));
  for (const agent of value) {
    const workspaceId = text(agent?.workspace_id, 100);
    const paneId = text(agent?.pane_id, 100);
    if (!workspaceId || !paneId) continue;
    const known = withIds.get(paneId);
    const entry = { paneId, cwd: text(agent.cwd, 4096), agent: text(agent.agent, 50), name: known?.agentName ?? null, sessionId: known?.claudeSessionId ?? null };
    byWorkspace.set(workspaceId, [...(byWorkspace.get(workspaceId) ?? []), entry]);
  }
  return byWorkspace;
}

export function assembleGroup(spec, workspaceOutput, agentOutput, branchByPath) {
  const base = { id: spec.id, label: spec.label, kind: spec.kind, command: spec.command };
  const workspaces = parseWorkspaces(workspaceOutput);
  if (!workspaces) return { ...base, reachable: false, workspaces: [] };
  const agents = parseTreeAgents(agentOutput);
  return {
    ...base,
    reachable: true,
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      label: workspace.label,
      status: workspace.status,
      repoKey: workspace.repoKey || null,
      linked: workspace.linked === true,
      checkoutPath: workspace.checkoutPath || null,
      branch: (workspace.checkoutPath && branchByPath.get(workspace.checkoutPath))
        || (agents.get(workspace.id) ?? []).map((agent) => agent.cwd && branchByPath.get(agent.cwd)).find(Boolean) || null,
      agents: (agents.get(workspace.id) ?? []).map((agent) => ({ paneId: agent.paneId, agent: agent.agent, name: agent.name, sessionId: agent.sessionId })),
    })),
  };
}

function runHerdr(args, timeoutMs) {
  return new Promise((resolve) => {
    execFile('herdr', args, { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : String(stdout));
    });
  });
}

export function createHerdrTree({ run = runHerdr, ttlMs = 10_000, timeoutMs = 4_000, now = Date.now } = {}) {
  let cached = null;
  let pending = null;

  async function loadGroup(spec) {
    const prefix = spec.args;
    const [workspaceOutput, agentOutput] = await Promise.all([
      run([...prefix, 'workspace', 'list'], timeoutMs),
      run([...prefix, 'agent', 'list'], timeoutMs),
    ]);
    const workspaces = parseWorkspaces(workspaceOutput) ?? [];
    // One worktree lookup per repository is enough: it lists every checkout of that repo.
    const branchByPath = new Map();
    const seenRepos = new Set();
    await Promise.all(workspaces.filter((workspace) => workspace.checkoutPath && workspace.repoKey && !seenRepos.has(workspace.repoKey) && seenRepos.add(workspace.repoKey))
      .map(async (workspace) => {
        const output = await run([...prefix, 'worktree', 'list', '--workspace', workspace.id], timeoutMs);
        for (const [path, branch] of parseWorktreeBranches(output)) branchByPath.set(path, branch);
      }));
    // Spaces that are not worktree workspaces carry no worktree field; ask herdr about the
    // pane's cwd instead (`worktree list --cwd` also works through --machine, no ssh needed).
    const covered = new Set(branchByPath.keys());
    const cwds = new Set();
    for (const [workspaceId, list] of parseTreeAgents(agentOutput)) {
      const known = workspaces.find((workspace) => workspace.id === workspaceId);
      const cwd = list.map((agent) => agent.cwd).find(Boolean);
      if (known && cwd && !(known.checkoutPath && covered.has(known.checkoutPath)) && !covered.has(cwd)) cwds.add(cwd);
    }
    const queue = [...cwds];
    await Promise.all(Array.from({ length: Math.min(8, queue.length) }, async () => {
      while (queue.length) {
        const cwd = queue.shift();
        const branch = branchForCwd(await run([...prefix, 'worktree', 'list', '--cwd', cwd], timeoutMs), cwd);
        if (branch) branchByPath.set(cwd, branch);
      }
    }));
    return assembleGroup(spec, workspaceOutput, agentOutput, branchByPath);
  }

  async function load() {
    const [sessionOutput, machineOutput] = await Promise.all([
      run(['session', 'list', '--json'], timeoutMs),
      run(['machine', 'list'], timeoutMs),
    ]);
    const specs = [
      ...parseRunningSessions(sessionOutput).map((name) => ({ id: `session:${name}`, label: name, kind: 'local', args: ['--session', name], command: `herdr --session ${name}` })),
      ...parseMachines(machineOutput).map((machine) => ({ id: `machine:${machine.name}`, label: machine.name, kind: 'machine', args: ['--machine', machine.name], command: `herdr --machine ${machine.name}` })),
    ];
    const groups = new Array(specs.length);
    let next = 0;
    async function worker() {
      while (next < specs.length) {
        const index = next++;
        groups[index] = await loadGroup(specs[index]).catch(() => ({ id: specs[index].id, label: specs[index].label, kind: specs[index].kind, command: specs[index].command, reachable: false, workspaces: [] }));
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, specs.length) }, worker));
    return { groups };
  }

  return {
    async snapshot() {
      if (cached && now() - cached.at < ttlMs) return cached.value;
      if (!pending) {
        pending = load().catch(() => ({ groups: [] })).then((value) => { cached = { at: now(), value }; return value; }).finally(() => { pending = null; });
      }
      return pending;
    },
  };
}
