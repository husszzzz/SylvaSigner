import { existsSync } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const emsdkDir = path.join(rootDir, "tools", "emsdk");
export const depsDir = path.join(rootDir, "deps");
export const buildDir = path.join(rootDir, ".build");
export const jobs = String(Math.max(1, cpus().length - 1));
export const isWindows = process.platform === "win32";

export function tool(name) {
  const suffixes = isWindows ? [".exe", ".cmd", ".bat", ".py", ""] : [""];
  for (const suffix of suffixes) {
    const local = path.join(emsdkDir, "upstream", "emscripten", `${name}${suffix}`);
    if (existsSync(local)) {
      return local;
    }
  }
  return isWindows ? `${name}.bat` : name;
}

export function emsdkCommand() {
  return path.join(emsdkDir, isWindows ? "emsdk.bat" : "emsdk");
}

export function makeCommand() {
  if (isWindows) {
    return "mingw32-make";
  }
  return "make";
}

export function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    stdio: options.stdio ?? "inherit",
    shell: options.shell ?? (isWindows && command.toLowerCase().endsWith(".bat")),
    env: {
      ...process.env,
      ...options.env
    }
  });
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}`);
  }
  return result;
}
