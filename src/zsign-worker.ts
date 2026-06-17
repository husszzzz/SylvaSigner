import type { OutputFile, RunZsignOptions, RunZsignResult, VirtualInputFile } from "./types";

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
  callMain(args: string[]): number;
};

type ZsignFactory = (options: Record<string, unknown>) => Promise<ZsignModule>;
type ZsignImport = { default: ZsignFactory };

const ctx = self as DedicatedWorkerGlobalScope;
const importModule = new Function("url", "return import(url)") as (url: string) => Promise<ZsignImport>;
const wasmCacheBust = "wasm_28a6421_original_native_with_cert_cache";

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

async function loadModule(logs: string[]) {
  const moduleUrl = `/wasm/zsign.mjs?v=${wasmCacheBust}`;
  const imported = await importModule(moduleUrl);
  return imported.default({
    noInitialRun: true,
    locateFile(file: string) {
      return `/wasm/${file}?v=${wasmCacheBust}`;
    },
    print(line: string) {
      logs.push(line);
    },
    printErr(line: string) {
      logs.push(line);
    }
  });
}

async function mountFiles(module: ZsignModule, files: VirtualInputFile[]) {
  const FS = module.FS;
  const workerFiles = files.filter((entry) => entry.mode === "workerfs");
  const memFiles = files.filter((entry) => entry.mode !== "workerfs");

  if (workerFiles.length) {
    ensureDir(FS, "/blob");
    const mounted = workerFiles.map((entry) => {
      const name = basename(entry.path);
      return entry.file instanceof File
        ? new File([entry.file], name, { lastModified: entry.file.lastModified, type: entry.file.type })
        : new File([entry.file], name);
    });
    FS.mount(module.WORKERFS, { files: mounted }, "/blob");
  }

  for (const entry of memFiles) {
    const target = normalizePath(entry.path);
    ensureDir(FS, dirname(target));
    FS.writeFile(target, new Uint8Array(await entry.file.arrayBuffer()));
  }
}

function readFileOutput(FS: any, filePath: string): OutputFile | null {
  try {
    const data = FS.readFile(filePath) as Uint8Array;
    const copy = new ArrayBuffer(data.byteLength);
    new Uint8Array(copy).set(data);
    return {
      path: filePath,
      name: basename(filePath),
      type: filePath.endsWith(".ipa") || filePath.endsWith(".zip") ? "application/zip" : "application/octet-stream",
      data: copy
    };
  } catch {
    return null;
  }
}

function collectDirectory(FS: any, dir: string, outputs: OutputFile[]) {
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
    if (FS.isDir(stat.mode)) {
      collectDirectory(FS, filePath, outputs);
    } else if (FS.isFile(stat.mode)) {
      const output = readFileOutput(FS, filePath);
      if (output) outputs.push(output);
    }
  }
}

async function execute(request: WorkerRequest): Promise<RunZsignResult> {
  const logs: string[] = [];
  const module = await loadModule(logs);
  const FS = module.FS;

  ensureDir(FS, "/work");
  ensureDir(FS, "/output");
  ensureDir(FS, "/tmp");
  FS.chdir("/work");

  if (request.options.persistCache !== false) {
    ensureDir(FS, "/work/.zsign_cache");
    FS.mount(module.IDBFS, {}, "/work/.zsign_cache");
    await syncfs(FS, true);
  }

  await mountFiles(module, request.files);

  let exitCode = -1;
  let trapped = false;
  try {
    exitCode = module.callMain(request.args);
  } catch (error) {
    trapped = true;
    const message = error instanceof Error ? error.message : String(error);
    logs.push(`>>> WASM trap: ${message}`);
  } finally {
    if (request.options.persistCache !== false) {
      try {
        await syncfs(FS, false);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logs.push(`>>> Cache sync failed after run: ${message}`);
      }
    }
  }

  if (trapped) {
    return { exitCode, logs, outputs: [] };
  }

  const outputs: OutputFile[] = [];
  for (const filePath of request.options.outputPaths ?? []) {
    const output = readFileOutput(FS, normalizePath(filePath));
    if (output) outputs.push(output);
  }
  collectDirectory(FS, "/output", outputs);
  for (const dir of request.options.collectDirectories ?? []) {
    collectDirectory(FS, normalizePath(dir), outputs);
  }

  const seen = new Set<string>();
  const uniqueOutputs = outputs.filter((output) => {
    if (seen.has(output.path)) return false;
    seen.add(output.path);
    return true;
  });

  return { exitCode, logs, outputs: uniqueOutputs };
}

ctx.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== "run") return;

  try {
    const result = await execute(request);
    const transfers = result.outputs.map((output) => output.data);
    ctx.postMessage({ id: request.id, ok: true, result }, transfers);
  } catch (error) {
    ctx.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
