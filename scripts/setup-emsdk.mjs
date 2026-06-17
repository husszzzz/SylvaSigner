import { existsSync } from "node:fs";
import path from "node:path";
import { emsdkCommand, emsdkDir, rootDir, run } from "./toolchain.mjs";

const version = "6.0.0";

if (!existsSync(emsdkDir)) {
  run("git", ["clone", "https://github.com/emscripten-core/emsdk.git", emsdkDir], { cwd: rootDir });
}

run(emsdkCommand(), ["install", version], { cwd: emsdkDir });
run(emsdkCommand(), ["activate", version], { cwd: emsdkDir });

console.log(`Emscripten ${version} is active in ${path.relative(rootDir, emsdkDir)}`);

