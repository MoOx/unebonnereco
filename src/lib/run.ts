import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RunOptions = {
  /** Bytes of stdout to buffer. Some yt-dlp dumps are large. */
  maxBuffer?: number;
  /**
   * Wall-clock limit, after which the child is killed.
   *
   * Not paranoia: a download stalled on a dead socket sat at 0% CPU for fourteen
   * hours before this existed. A retry loop only helps if the failure is an error;
   * a hang has to be turned into one.
   */
  timeoutMs?: number;
};

/**
 * Run a command and return its stdout.
 *
 * Uses execFile (not a shell) so arguments are passed through verbatim — which
 * matters here because YouTube ids can start with a dash and would otherwise be
 * mangled or read as flags.
 */
export async function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<string> {
  if (!options.timeoutMs) {
    const { stdout } = await execFileAsync(command, args, {
      maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
      encoding: "utf8",
    });
    return stdout;
  }

  /* Run in its own process group so a timeout can take the whole tree down.
     execFile's own `timeout` only kills the command itself: yt-dlp shells out to
     ffmpeg, and killing the parent left ffmpeg running for an hour on a dead
     socket. Signalling the negated pid reaches every descendant. */
  const { spawn } = await import("node:child_process");
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => (out += chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => (err += chunk.slice(0, 2000)));

    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      reject(new Error(`${command} timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${command} exited with code ${code}\n${err}`));
    });
  });
}

/** Run a command for its side effects, streaming its output to the terminal. */
export async function runInherit(command: string, args: string[]): Promise<void> {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with code ${code}`)),
    );
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
