import { BlobReader, BlobWriter, Reader, ZipReader, ZipWriter, type FileEntry } from "@zip.js/zip.js";

type ZipProgress = (completed: number, total: number) => void;

type ArchiveEntry = {
  path: string;
  directory: boolean;
  handle?: FileSystemFileHandle;
};

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

function extractionConcurrency() {
  const browser = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { mobile?: boolean };
  };
  const mobile =
    browser.userAgentData?.mobile === true ||
    /Android|iPad|iPhone|iPod|Mobile/i.test(browser.userAgent) ||
    (/Macintosh/i.test(browser.userAgent) && browser.maxTouchPoints > 1);
  if (mobile) return 1;

  const memory = browser.deviceMemory;
  const memoryLimit = memory !== undefined && memory <= 4 ? 2 : 4;
  const cpuLimit = Math.max(1, Math.floor((browser.hardwareConcurrency || 2) / 2));
  return Math.min(memoryLimit, cpuLimit);
}

async function parallelFor<T>(items: T[], action: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(extractionConcurrency(), items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await action(item);
    }
  });
  await Promise.all(workers);
}

function safeZipPath(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts = normalized.split("/").filter(Boolean);
  if (normalized.startsWith("/") || parts.some((part) => part === "." || part === "..")) {
    throw new Error(`Unsafe IPA entry path: ${path}`);
  }
  return parts;
}

async function ensureDirectory(root: FileSystemDirectoryHandle, parts: string[]) {
  let current = root;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

export async function extractIpaToOpfs(
  ipa: Blob,
  destination: FileSystemDirectoryHandle,
  onProgress?: ZipProgress
) {
  const reader = new ZipReader(new BlobReader(ipa), {
    useCompressionStream: true,
    useWebWorkers: false
  });

  try {
    const entries = await reader.getEntries();
    const total = entries.reduce((sum, entry) => sum + (entry.directory ? 0 : entry.uncompressedSize), 0);
    const estimate = await navigator.storage.estimate();
    const available = (estimate.quota ?? 0) - (estimate.usage ?? 0);
    const reserve = Math.max(ipa.size * 2, 64 * 1024 * 1024);
    if (available > 0 && total + reserve > available) {
      throw new Error("Not enough browser storage is available to extract and sign this IPA.");
    }

    let completed = 0;
    onProgress?.(completed, total);
    await parallelFor(entries, async (entry) => {
      const parts = safeZipPath(entry.filename);
      if (!parts.length) return;
      if (entry.directory) {
        await ensureDirectory(destination, parts);
        return;
      }

      const parent = await ensureDirectory(destination, parts.slice(0, -1));
      const fileHandle = await parent.getFileHandle(parts.at(-1)!, { create: true });
      const writable = await fileHandle.createWritable();
      try {
        await (entry as FileEntry).getData(writable, {
          useCompressionStream: true,
          useWebWorkers: false
        });
      } catch (error) {
        await writable.abort(error).catch(() => undefined);
        throw error;
      }
      completed += entry.uncompressedSize;
      onProgress?.(completed, total);
    });
    return { entries: entries.length, uncompressedSize: total };
  } finally {
    await reader.close();
  }
}

function ensureMemfsDirectory(FS: any, path: string) {
  const parts = path.split("/").filter(Boolean);
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

export async function extractIpaToMemfs(
  ipa: Blob,
  FS: any,
  destination: string,
  onProgress?: ZipProgress
) {
  const reader = new ZipReader(new BlobReader(ipa), {
    useCompressionStream: true,
    useWebWorkers: false
  });
  try {
    const entries = await reader.getEntries();
    const total = entries.reduce((sum, entry) => sum + (entry.directory ? 0 : entry.uncompressedSize), 0);
    let completed = 0;
    ensureMemfsDirectory(FS, destination);
    onProgress?.(completed, total);

    await parallelFor(entries, async (entry) => {
      const parts = safeZipPath(entry.filename);
      if (!parts.length) return;
      const path = `${destination.replace(/\/$/, "")}/${parts.join("/")}`;
      if (entry.directory) {
        ensureMemfsDirectory(FS, path);
        return;
      }
      ensureMemfsDirectory(FS, path.slice(0, path.lastIndexOf("/")));
      const stream = FS.open(path, "w");
      if (entry.uncompressedSize > 0) FS.ftruncate(stream.fd, entry.uncompressedSize);
      let offset = 0;
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          FS.close(stream);
        }
      };
      const writable = new WritableStream<Uint8Array>({
        write(chunk) {
          FS.write(stream, chunk, 0, chunk.byteLength, offset);
          offset += chunk.byteLength;
        },
        close,
        abort: close
      });
      await (entry as FileEntry).getData(writable, {
        useCompressionStream: true,
        useWebWorkers: false
      });
      completed += entry.uncompressedSize;
      onProgress?.(completed, total);
    });
    return { entries: entries.length, uncompressedSize: total };
  } finally {
    await reader.close();
  }
}

type MemfsArchiveEntry = {
  path: string;
  directory: boolean;
  size: number;
};

function collectMemfsEntries(
  FS: any,
  directory: string,
  prefix: string,
  entries: MemfsArchiveEntry[]
) {
  for (const name of FS.readdir(directory)) {
    if (name === "." || name === "..") continue;
    const path = `${directory.replace(/\/$/, "")}/${name}`;
    const relative = prefix ? `${prefix}/${name}` : name;
    const stat = FS.stat(path);
    if (FS.isDir(stat.mode)) {
      entries.push({ path: `${relative}/`, directory: true, size: 0 });
      collectMemfsEntries(FS, path, relative, entries);
    } else if (FS.isFile(stat.mode)) {
      entries.push({ path: relative, directory: false, size: stat.size });
    }
  }
}

class MemfsReader extends Reader<null> {
  private readonly FS: any;
  private readonly stream: any;
  private closed = false;

  constructor(FS: any, path: string, size: number) {
    super(null);
    this.FS = FS;
    this.stream = FS.open(path, "r");
    this.size = size;
  }

  async readUint8Array(index: number, length: number) {
    const chunk = new Uint8Array(Math.max(0, Math.min(length, this.size - index)));
    if (!chunk.byteLength) return chunk;
    const read = this.FS.read(this.stream, chunk, 0, chunk.byteLength, index);
    return read === chunk.byteLength ? chunk : chunk.subarray(0, read);
  }

  close() {
    if (!this.closed) {
      this.closed = true;
      this.FS.close(this.stream);
    }
  }
}

export async function archiveMemfsToIpa(
  FS: any,
  source: string,
  level: number,
  onProgress?: ZipProgress
) {
  const entries: MemfsArchiveEntry[] = [];
  collectMemfsEntries(FS, source, "", entries);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  const output = new BlobWriter("application/zip");
  const writer = new ZipWriter(output, {
    level,
    zip64: false,
    useCompressionStream: true,
    useWebWorkers: false,
    extendedTimestamp: false
  });

  let completed = 0;
  onProgress?.(completed, total);
  for (const entry of entries) {
    if (entry.directory) {
      await writer.add(entry.path, undefined, { directory: true, zip64: false });
      continue;
    }

    const reader = new MemfsReader(FS, `${source.replace(/\/$/, "")}/${entry.path}`, entry.size);
    try {
      await writer.add(entry.path, reader, {
        level,
        zip64: false,
        useCompressionStream: true,
        useWebWorkers: false
      });
    } finally {
      reader.close();
    }
    completed += entry.size;
    onProgress?.(completed, total);
  }
  await writer.close();
  return output.getData();
}

async function collectFiles(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  entries: ArchiveEntry[]
) {
  for await (const [name, handle] of (directory as IterableDirectoryHandle).entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      entries.push({ path: `${path}/`, directory: true });
      await collectFiles(handle as FileSystemDirectoryHandle, path, entries);
    } else {
      entries.push({ path, directory: false, handle: handle as FileSystemFileHandle });
    }
  }
}

export async function archiveOpfsToIpa(
  source: FileSystemDirectoryHandle,
  output: FileSystemFileHandle,
  level: number,
  onProgress?: ZipProgress
) {
  const entries: ArchiveEntry[] = [];
  await collectFiles(source, "", entries);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  const total = (
    await Promise.all(
      entries.map(async (entry) => (entry.directory ? 0 : (await entry.handle!.getFile()).size))
    )
  ).reduce((sum, size) => sum + size, 0);

  const writable = await output.createWritable();
  const writer = new ZipWriter(writable, {
    level,
    zip64: false,
    useCompressionStream: true,
    useWebWorkers: false,
    extendedTimestamp: false
  });

  let completed = 0;
  onProgress?.(completed, total);
  try {
    for (const entry of entries) {
      if (entry.directory) {
        await writer.add(entry.path, undefined, { directory: true, zip64: false });
        continue;
      }

      const file = await entry.handle!.getFile();
      await writer.add(entry.path, new BlobReader(file), {
        level,
        zip64: false,
        lastModDate: file.lastModified ? new Date(file.lastModified) : new Date(),
        useCompressionStream: true,
        useWebWorkers: false
      });
      completed += file.size;
      onProgress?.(completed, total);
    }
    await writer.close();
  } catch (error) {
    await writable.abort(error).catch(() => undefined);
    throw error;
  }

  return output.getFile();
}
