export type VirtualFileMode = "memfs" | "workerfs";

export interface VirtualInputFile {
  path: string;
  file: Blob;
  mode?: VirtualFileMode;
}

export interface OutputFile {
  path: string;
  name: string;
  type: string;
  data: ArrayBuffer;
}

export interface RunZsignOptions {
  outputPaths?: string[];
  collectDirectories?: string[];
  persistCache?: boolean;
  storageMode?: "auto" | "memory" | "opfs";
  onLog?: (line: string) => void;
}

export interface RunZsignResult {
  exitCode: number;
  logs: string[];
  outputs: OutputFile[];
}

export interface SignIpaOptions {
  ipa: File;
  p12?: File;
  privateKey?: File;
  certificate?: File;
  profiles?: File[];
  entitlements?: File;
  dylibs?: File[];
  password?: string;
  outputName?: string;
  zipLevel?: number;
  adhoc?: boolean;
  debug?: boolean;
  force?: boolean;
  quiet?: boolean;
  sha256Only?: boolean;
  weakDylib?: boolean;
  checkSignature?: boolean;
  install?: boolean;
  removeProvision?: boolean;
  enableDocuments?: boolean;
  removeExtensions?: boolean;
  removeWatch?: boolean;
  removeUISupportedDevices?: boolean;
  bundleId?: string;
  bundleName?: string;
  bundleVersion?: string;
  minimumVersion?: string;
  metadata?: boolean;
  removeDylibs?: string[];
}
