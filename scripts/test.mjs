// Runs the unit tests: compiles every `*.test.ts` at the root, with the modules
// it imports, into a temporary folder with tsc, then runs them with node --test.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tests = readdirSync(root)
  .filter((file) => file.endsWith(".test.ts"))
  .sort();
const out = mkdtempSync(join(tmpdir(), "memory-explorer-tests-"));
try {
  execFileSync(
    join(root, "node_modules", ".bin", "tsc"),
    [
      ...tests,
      "--strict",
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      "--target",
      "es2022",
      "--types",
      "node",
      "--outDir",
      out,
    ],
    { cwd: root, stdio: "inherit" },
  );
  writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
  symlinkSync(join(root, "node_modules"), join(out, "node_modules"));
  execFileSync(
    process.execPath,
    ["--test", ...tests.map((file) => join(out, file.replace(/\.ts$/, ".js")))],
    { stdio: "inherit" },
  );
} finally {
  rmSync(out, { recursive: true, force: true });
}
