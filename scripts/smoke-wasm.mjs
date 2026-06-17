import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { rootDir } from "./toolchain.mjs";

const modulePath = path.join(rootDir, "public", "wasm", "zsign.mjs");
const wasmPath = path.join(rootDir, "public", "wasm", "zsign.wasm");

if (!existsSync(modulePath) || !existsSync(wasmPath)) {
  throw new Error("Missing public/wasm/zsign artifacts. Run `npm run build:wasm` first.");
}

const logs = [];
const createZsignModule = (await import(pathToFileURL(modulePath).href)).default;
const mod = await createZsignModule({
  noInitialRun: true,
  wasmBinary: readFileSync(wasmPath),
  locateFile(file) {
    return path.join(rootDir, "public", "wasm", file);
  },
  print(line) {
    logs.push(line);
  },
  printErr(line) {
    logs.push(line);
  }
});

const code = mod.callMain(["-v"]);
const text = logs.join("\n");

if (code !== 0 || !text.includes("version:")) {
  console.error(text);
  throw new Error(`Unexpected zsign -v result: ${code}`);
}

console.log(text);
console.log("WASM smoke test passed.");
