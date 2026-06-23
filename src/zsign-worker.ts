import type { OutputFile, RunZsignOptions, RunZsignResult, VirtualInputFile } from "./types";
import { archiveOpfsToIpa, extractIpaToMemfs, extractIpaToOpfs } from "./browser-zip";

type WorkerRequest = {
  id: number;
  type: "run";
  args: string[];
  files: VirtualInputFile[];
  options: RunZsignOptions;
};

type ZsignModule = {
  FS: any;
  WORKERFS: any;
  IDBFS: any;
  callMain(args: string[]): number | Promise<number>;
  ccall?: (
    name: string,
    returnType: string,
    argTypes: string[],
    args: unknown[],
    options: { async: boolean }
  ) => number | Promise<number>;
};

type ZsignFactory = (options: Record<string, unknown>) => Promise<ZsignModule>;
type ZsignImport = { default: ZsignFactory };
type StorageManagerWithDirectory = StorageManager & {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
};
type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

const ctx = self as DedicatedWorkerGlobalScope;
const importModule = new Function("url", "return import(url)") as (url: string) => Promise<ZsignImport>;
const wasmCacheBust = "wasm_28a6421_dylib_fix_v2";
const opfsProjectDir = "sylva-zsign";

type BrowserZipPlan = {
  inputPath: string;
  outputPath: string;
  ipa: VirtualInputFile;
  level: number;
};

function dirname(filePath: string) {
  const normalized = filePath.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function basename(filePath: string) {
  return filePath.replaceAll("\\", "/").split("/").filter(Boolean).pop() || "file";
}

function normalizePath(filePath: string) {
  const normalized = filePath.replaceAll("\\", "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function outputType(filePath: string) {
  return filePath.endsWith(".ipa") || filePath.endsWith(".zip")
    ? "application/zip"
    : "application/octet-stream";
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

function browserZipPlan(request: WorkerRequest): BrowserZipPlan | null {
  if (request.args.some((arg) => arg === "-x" || arg === "--metadata" || arg === "-i" || arg === "--install")) {
    return null;
  }
  const inputPath = request.args.at(-1);
  if (!inputPath || !inputPath.toLowerCase().endsWith(".ipa")) return null;
  const ipa = request.files.find((entry) => normalizePath(entry.path) === normalizePath(inputPath));
  const outputPath = request.options.outputPaths?.[0];
  if (!ipa || !outputPath) return null;

  const zipIndex = request.args.findIndex((arg) => arg === "-z" || arg === "--zip_level");
  const parsedLevel = zipIndex >= 0 ? Number(request.args[zipIndex + 1]) : 1;
  return {
    inputPath,
    outputPath: normalizePath(outputPath),
    ipa,
    level: Number.isInteger(parsedLevel) && parsedLevel >= 0 && parsedLevel <= 9 ? parsedLevel : 1
  };
}

function folderSigningArgs(
  args: string[],
  plan: BrowserZipPlan,
  extractedPath: string,
  nativeArchive: boolean
) {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!nativeArchive && (arg === "-o" || arg === "--output" || arg === "-z" || arg === "--zip_level")) {
      index++;
      continue;
    }
    result.push(normalizePath(arg) === normalizePath(plan.inputPath) ? extractedPath : arg);
  }
  if (!result.includes("-f") && !result.includes("--force")) result.unshift("-f");
  return result;
}

function progressEmitter(request: WorkerRequest, phase: "extract" | "archive") {
  let previousPercent = -1;
  return (completed: number, total: number) => {
    const percent = total > 0 ? Math.floor((completed / total) * 100) : 100;
    if (percent === previousPercent) return;
    previousPercent = percent;
    ctx.postMessage({
      id: request.id,
      type: "progress",
      ok: true,
      progress: { phase, completed, total }
    });
  };
}

function ensureDir(FS: any, dir: string) {
  const parts = normalizePath(dir).split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    try {
      FS.mkdir(current);
    } catch (error: any) {
      if (error?.errno !== 20) throw error;
    }
  }
}

function syncfs(FS: any, populate: boolean) {
  return new Promise<void>((resolve, reject) => {
    FS.syncfs(populate, (error: unknown) => (error ? reject(error) : resolve()));
  });
}

async function loadModule(
  variant: "zsign" | "zsign-mobile" | "zsign-opfs",
  logs: string[],
  emitLog: (line: string) => void
) {
  const moduleUrl = `/wasm/${variant}.mjs?v=${wasmCacheBust}`;
  const imported = await importModule(moduleUrl);
  const recordLog = (line: string) => {
    logs.push(line);
    emitLog(line);
  };
  return imported.default({
    noInitialRun: true,
    locateFile(file: string) {
      return `/wasm/${file}?v=${wasmCacheBust}`;
    },
    print(...parts: unknown[]) {
      recordLog(parts.map(String).join(" "));
    },
    printErr(...parts: unknown[]) {
      recordLog(parts.map(String).join(" "));
    }
  });
}

async function mountFiles(module: ZsignModule, files: VirtualInputFile[]) {
  const FS = module.FS;
  const workerFiles = files.filter((entry) => entry.mode === "workerfs");
  const memFiles = files.filter((entry) => entry.mode !== "workerfs");

  if (workerFiles.length) {
    ensureDir(FS, "/blob");
    FS.mount(
      module.WORKERFS,
      { blobs: workerFiles.map((entry) => ({ name: basename(entry.path), data: entry.file })) },
      "/blob"
    );
  }

  for (const entry of memFiles) {
    const target = normalizePath(entry.path);
    ensureDir(FS, dirname(target));
    FS.writeFile(target, new Uint8Array(await entry.file.arrayBuffer()));
  }
}

function readFileOutput(FS: any, filePath: string, transferOwnership = false): OutputFile | null {
  try {
    if (transferOwnership) {
      const node = FS.analyzePath(filePath).object;
      const contents = node?.contents;
      if (contents instanceof Uint8Array) {
        const usedBytes = Math.min(node.usedBytes ?? contents.byteLength, contents.byteLength);
        const data = contents.subarray(0, usedBytes) as Uint8Array<ArrayBuffer>;
        return { path: filePath, name: basename(filePath), type: outputType(filePath), data };
      }
    }
    const data = FS.readFile(filePath) as Uint8Array;
    const outputBuffer =
      data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
        ? (data.buffer as ArrayBuffer)
        : data.slice().buffer;
    return { path: filePath, name: basename(filePath), type: outputType(filePath), data: outputBuffer };
  } catch {
    return null;
  }
}

function collectMemoryDirectory(FS: any, dir: string, outputs: OutputFile[]) {
  let entries: string[];
  try {
    entries = FS.readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === "." || entry === "..") continue;
    const filePath = `${dir.replace(/\/$/, "")}/${entry}`;
    const stat = FS.stat(filePath);
    if (FS.isDir(stat.mode)) collectMemoryDirectory(FS, filePath, outputs);
    else if (FS.isFile(stat.mode)) {
      if (outputs.some((output) => output.path === filePath)) continue;
      const output = readFileOutput(FS, filePath);
      if (output) outputs.push(output);
    }
  }
}

function uniqueOutputs(outputs: OutputFile[]) {
  const seen = new Set<string>();
  return outputs.filter((output) => {
    if (seen.has(output.path)) return false;
    seen.add(output.path);
    return true;
  });
}

async function runMain(
  module: ZsignModule,
  args: string[],
  logs: string[],
  emitLog: (line: string) => void
) {
  try {
    const exitCode = module.ccall
      ? await module.ccall("zsign_run_args", "number", ["string"], [args.join("\x1f")], { async: true })
      : await module.callMain(args);
    return { exitCode, trapped: false };
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    const line = `>>> WASM trap: ${message}`;
    logs.push(line);
    emitLog(line);
    return { exitCode: -1, trapped: true };
  }
}

async function executeMemory(
  request: WorkerRequest,
  logs: string[],
  emitLog: (line: string) => void
): Promise<RunZsignResult> {
  const mobileNative = request.options.storageMode === "mobile-native";
  const module = await loadModule(mobileNative ? "zsign-mobile" : "zsign", logs, emitLog);
  const FS = module.FS;
  const zipPlan = mobileNative ? null : browserZipPlan(request);
  ensureDir(FS, "/work");
  ensureDir(FS, "/output");
  ensureDir(FS, "/tmp");
  FS.chdir("/work");

  if (mobileNative) {
    const line = ">>> Mobile mode: native zsign archive pipeline with WORKERFS input";
    logs.push(line);
    emitLog(line);
  }

  if (request.options.persistCache !== false) {
    ensureDir(FS, "/work/.zsign_cache");
    FS.mount(module.IDBFS, {}, "/work/.zsign_cache");
    await syncfs(FS, true);
  }

  await mountFiles(module, zipPlan ? request.files.filter((entry) => entry !== zipPlan.ipa) : request.files);
  let nativeArgs = request.args;
  if (zipPlan) {
    const started = performance.now();
    const unzipLine = `>>> Unzip:\t${formatBytes(zipPlan.ipa.file.size)} -> WebAssembly memory ...`;
    logs.push(unzipLine);
    emitLog(unzipLine);
    await extractIpaToMemfs(zipPlan.ipa.file, FS, "/work/extracted", progressEmitter(request, "extract"));
    const completeLine = `>>> Unzip OK! (${((performance.now() - started) / 1000).toFixed(3)}s)`;
    logs.push(completeLine);
    emitLog(completeLine);
    nativeArgs = folderSigningArgs(request.args, zipPlan, "/work/extracted", true);
  }
  const result = await runMain(module, nativeArgs, logs, emitLog);

  if (request.options.persistCache !== false) {
    try {
      await syncfs(FS, false);
    } catch (error) {
      const line = `>>> Cache sync failed after run: ${error instanceof Error ? error.message : String(error)}`;
      logs.push(line);
      emitLog(line);
    }
  }
  if (result.trapped) return { exitCode: result.exitCode, logs, outputs: [] };

  const outputs: OutputFile[] = [];
  for (const filePath of request.options.outputPaths ?? []) {
    const output = readFileOutput(FS, normalizePath(filePath), mobileNative);
    if (output) outputs.push(output);
  }
  collectMemoryDirectory(FS, "/output", outputs);
  for (const dir of request.options.collectDirectories ?? []) {
    collectMemoryDirectory(FS, normalizePath(dir), outputs);
  }
  return { exitCode: result.exitCode, logs, outputs: uniqueOutputs(outputs) };
}

async function getDirectory(
  root: FileSystemDirectoryHandle,
  path: string,
  create = false
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const part of path.split("/").filter(Boolean)) {
    current = await current.getDirectoryHandle(part, { create });
  }
  return current;
}

async function writeOpfsFile(root: FileSystemDirectoryHandle, path: string, blob: Blob) {
  const parent = await getDirectory(root, dirname(path), true);
  const handle = await parent.getFileHandle(basename(path), { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function readOpfsOutput(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  publicPath: string
): Promise<OutputFile | null> {
  try {
    const parent = await getDirectory(root, dirname(relativePath));
    const handle = await parent.getFileHandle(basename(relativePath));
    const file = await handle.getFile();
    return {
      path: publicPath,
      name: basename(publicPath),
      type: outputType(publicPath),
      data: file
    };
  } catch {
    return null;
  }
}

async function collectOpfsDirectory(
  directory: FileSystemDirectoryHandle,
  relativePath: string,
  publicPath: string,
  outputs: OutputFile[]
) {
  let target: FileSystemDirectoryHandle;
  try {
    target = await getDirectory(directory, relativePath);
  } catch {
    return;
  }
  for await (const [name, handle] of (target as IterableDirectoryHandle).entries()) {
    const childRelative = `${relativePath.replace(/\/$/, "")}/${name}`;
    const childPublic = `${publicPath.replace(/\/$/, "")}/${name}`;
    if (handle.kind === "directory") {
      await collectOpfsDirectory(directory, childRelative, childPublic, outputs);
    } else {
      const output = await readOpfsOutput(directory, childRelative, childPublic);
      if (output) outputs.push(output);
    }
  }
}

function useOpfs(request: WorkerRequest) {
  if (request.options.storageMode === "memory" || request.options.storageMode === "mobile-native") return false;
  const storage = navigator.storage as StorageManagerWithDirectory;
  if (typeof storage?.getDirectory !== "function") return false;
  if (request.options.storageMode === "opfs") return true;
  return false;
}

async function executeOpfs(
  request: WorkerRequest,
  logs: string[],
  emitLog: (line: string) => void
): Promise<RunZsignResult> {
  const root = await (navigator.storage as StorageManagerWithDirectory).getDirectory();
  const project = await getDirectory(root, opfsProjectDir, true);
  await getDirectory(project, "work/.zsign_cache", true);
  const sessions = await getDirectory(project, "sessions", true);
  const sessionName = `session-${Date.now()}-${crypto.randomUUID()}`;
  const session = await sessions.getDirectoryHandle(sessionName, { create: true });
  const wasmBase = `/opfs/${opfsProjectDir}/sessions/${sessionName}`;
  const mapPath = (path: string) => `${wasmBase}${normalizePath(path)}`;
  const relativePath = (path: string) => normalizePath(path).slice(1);
  const zipPlan = browserZipPlan(request);

  const storageLine = ">>> Storage: browser disk mode (lower memory use)";
  logs.push(storageLine);
  emitLog(storageLine);

  try {
    await Promise.all([
      getDirectory(session, "blob", true),
      getDirectory(session, "output", true),
      getDirectory(session, "tmp", true),
      getDirectory(session, "work", true)
    ]);
    for (const entry of request.files) {
      if (zipPlan && entry === zipPlan.ipa) continue;
      await writeOpfsFile(session, relativePath(entry.path), entry.file);
    }

    let nativeArgs = request.args;
    if (zipPlan) {
      const extractedRelative = "work/extracted";
      const extracted = await getDirectory(session, extractedRelative, true);
      const started = performance.now();
      const unzipLine = `>>> Unzip:\t${formatBytes(zipPlan.ipa.file.size)} -> browser storage ...`;
      logs.push(unzipLine);
      emitLog(unzipLine);
      await extractIpaToOpfs(zipPlan.ipa.file, extracted, progressEmitter(request, "extract"));
      const completeLine = `>>> Unzip OK! (${((performance.now() - started) / 1000).toFixed(3)}s)`;
      logs.push(completeLine);
      emitLog(completeLine);
      nativeArgs = folderSigningArgs(request.args, zipPlan, `/${extractedRelative}`, false);
    }

    const module = await loadModule("zsign-opfs", logs, emitLog);
    const args = nativeArgs.map((arg) => (arg.startsWith("/") ? mapPath(arg) : arg));
    if (!args.includes("-t") && !args.includes("--temp_folder")) {
      args.unshift(mapPath("/tmp"));
      args.unshift("-t");
    }
    const result = await runMain(module, args, logs, emitLog);
    if (result.trapped) {
      const startedSigning = logs.some((line) => />>>\s*(Unzip|Signing):/i.test(line));
      if (!startedSigning && request.options.storageMode !== "opfs") {
        throw new Error("The low-memory browser storage runtime could not start.");
      }
      return { exitCode: result.exitCode, logs, outputs: [] };
    }

    if (zipPlan && result.exitCode === 0) {
      const started = performance.now();
      const archiveLine = `>>> Archiving:\t${zipPlan.outputPath} ...`;
      logs.push(archiveLine);
      emitLog(archiveLine);
      const outputParent = await getDirectory(session, dirname(relativePath(zipPlan.outputPath)), true);
      const outputHandle = await outputParent.getFileHandle(basename(zipPlan.outputPath), { create: true });
      const extracted = await getDirectory(session, "work/extracted");
      const output = await archiveOpfsToIpa(
        extracted,
        outputHandle,
        zipPlan.level,
        progressEmitter(request, "archive")
      );
      const completeLine = `>>> Archive OK! (${(output.size / 1024 / 1024).toFixed(2)} MB) (${(
        (performance.now() - started) /
        1000
      ).toFixed(3)}s)`;
      logs.push(completeLine);
      emitLog(completeLine);
    }

    const outputs: OutputFile[] = [];
    for (const path of request.options.outputPaths ?? []) {
      const output = await readOpfsOutput(session, relativePath(path), normalizePath(path));
      if (output) outputs.push(output);
    }
    await collectOpfsDirectory(session, "output", "/output", outputs);
    for (const path of request.options.collectDirectories ?? []) {
      await collectOpfsDirectory(session, relativePath(path), normalizePath(path), outputs);
    }
    return { exitCode: result.exitCode, logs, outputs: uniqueOutputs(outputs) };
  } finally {
    await sessions.removeEntry(sessionName, { recursive: true }).catch(() => undefined);
  }
}

async function execute(request: WorkerRequest): Promise<RunZsignResult> {
  const logs: string[] = [];
  const emitLog = (line: string) => ctx.postMessage({ id: request.id, type: "log", ok: true, line });
  if (!useOpfs(request)) return executeMemory(request, logs, emitLog);

  try {
    return await executeOpfs(request, logs, emitLog);
  } catch (error) {
    if (request.options.storageMode === "opfs") throw error;
    const line = `>>> Browser disk mode unavailable; using memory mode: ${
      error instanceof Error ? error.message : String(error)
    }`;
    logs.push(line);
    emitLog(line);
    return executeMemory(request, logs, emitLog);
  }
}

ctx.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== "run") return;
  try {
    const result = await execute(request);
    const transfers = [...new Set(result.outputs.flatMap((output) => {
      if (output.data instanceof ArrayBuffer) return [output.data];
      if (output.data instanceof Uint8Array && output.data.buffer instanceof ArrayBuffer) {
        return [output.data.buffer];
      }
      return [];
    }))];
    ctx.postMessage({ id: request.id, type: "done", ok: true, result }, transfers);
  } catch (error) {
    ctx.postMessage({
      id: request.id,
      type: "done",
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
