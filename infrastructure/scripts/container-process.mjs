import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export const composeArguments = (project) => [
  "compose",
  "--env-file",
  "/dev/null",
  "--file",
  "infrastructure/compose.preview.yaml",
  "--project-name",
  project,
];

// Bounded, binary-safe transfers for disposable container fixtures only.
export async function runDocker(environment, args, input) {
  const pending = execute("docker", args, {
    env: environment,
    encoding: "buffer",
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  let inputError;
  pending.child.stdin.on("error", (error) => {
    inputError = error;
  });
  pending.child.stdin.end(input);
  try {
    const { stdout } = await pending;
    if (inputError) throw inputError;
    return stdout;
  } catch (error) {
    throw new Error(
      error.stderr?.toString("utf8").trim() || `Docker ${args[0]} failed.`,
    );
  }
}
