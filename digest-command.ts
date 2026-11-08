// The digest command: an optional program the server runs after a preference
// is confirmed or discarded (the `digestCommand` setting), for example a
// script that rebuilds a digest memory listing every preference. It runs
// without a shell, and its failure never fails the confirm or the discard.
//
// The plugin server is started by the BB app, so its PATH may lack `node` and
// `bb`: a `.js`, `.mjs` or `.cjs` script runs with an explicitly resolved Node,
// and BB_CLI names the bb command when the server knows where it is.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

export type RunFile = (
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<void>;

/** How long the command may run. */
const TIMEOUT_MS = 60_000;

/** Runs a file without a shell. */
export const runFile: RunFile = (file, args, env) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: TIMEOUT_MS, env }, (error) =>
      error ? reject(error) : resolve(),
    );
  });

export interface RuntimeProbe {
  electron: boolean;
  execPath: string;
  env: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
}

/** The node that runs a script: the server's own, except under Electron (whose binary is not node). */
export function nodeRuntime(
  probe: RuntimeProbe = {
    electron: Boolean(process.versions.electron),
    execPath: process.execPath,
    env: process.env,
    exists: existsSync,
  },
): string {
  if (!probe.electron) return probe.execPath;
  return (
    probe.env.BB_NODE ??
    ["/opt/homebrew/bin/node", "/usr/local/bin/node"].find(probe.exists) ??
    "node"
  );
}

/** `command` as words: runs of non-space characters, or text in double quotes (for a path with spaces). */
export function parseCommand(command: string): string[] {
  return [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);
}

const SCRIPT = /\.[cm]?js$/i;

/**
 * Runs `command` (nothing when it is blank). A script runs with `node`; any
 * other program runs as it is. `bbCli`, when given, becomes BB_CLI unless the
 * environment already has one. A failure is logged, never thrown.
 */
export async function runDigestCommand(
  command: string,
  {
    run = runFile,
    log = (message: string) => console.warn(message),
    node = nodeRuntime(),
    baseEnv = process.env,
    bbCli,
  }: {
    run?: RunFile;
    log?: (message: string) => void;
    node?: string;
    baseEnv?: NodeJS.ProcessEnv;
    bbCli?: string;
  } = {},
): Promise<void> {
  const words = parseCommand(command);
  const program = words[0];
  if (program === undefined) return;
  const rest = words.slice(1);
  const env =
    baseEnv.BB_CLI === undefined && bbCli !== undefined ? { ...baseEnv, BB_CLI: bbCli } : { ...baseEnv };
  try {
    if (SCRIPT.test(program)) await run(node, [program, ...rest], env);
    else await run(program, rest, env);
  } catch (error) {
    log(
      `[memory-explorer] the digest command failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
