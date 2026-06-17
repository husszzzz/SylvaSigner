import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { buildDir, rootDir, run, tool } from "./toolchain.mjs";

const upstream = path.join(rootDir, "vendor", "zsign");
const src = path.join(upstream, "src");
const common = path.join(src, "common");
const zlib = path.join(src, "third-party", "zlib");
const minizip = path.join(src, "third-party", "minizip");
const opensslPrefix = path.join(rootDir, "deps", "openssl-wasm");
const opensslLib = path.join(opensslPrefix, "lib", "libcrypto.a");
const outputDir = path.join(rootDir, "public", "wasm");
const objDir = path.join(buildDir, "wasm", "obj");

if (!existsSync(opensslLib)) {
  throw new Error("OpenSSL WASM libs are missing. Run `npm run build:openssl` first.");
}

rmSync(objDir, { recursive: true, force: true });
mkdirSync(objDir, { recursive: true });
mkdirSync(outputDir, { recursive: true });

function files(dir, ext) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(ext))
    .map((name) => path.join(dir, name));
}

const includeFlags = [
  `-I${src}`,
  `-I${common}`,
  `-I${zlib}`,
  `-I${path.join(opensslPrefix, "include")}`
];

const cSources = [
  ...files(zlib, ".c"),
  path.join(minizip, "ioapi.c"),
  path.join(minizip, "zip.c"),
  path.join(minizip, "unzip.c")
];
const cppSources = [...files(src, ".cpp"), ...files(common, ".cpp")];
const objects = [];

for (const source of cSources) {
  const object = path.join(objDir, `${path.basename(source, ".c")}.o`);
  run(tool("emcc"), ["-O3", "-Wno-unused-result", ...includeFlags, "-c", source, "-o", object]);
  objects.push(object);
}

for (const source of cppSources) {
  const object = path.join(objDir, `${path.basename(source, ".cpp")}.o`);
  run(tool("em++"), [
    "-std=c++11",
    "-O3",
    "-Wno-unused-result",
    "-DZSIGN_VERSION=wasm_28a6421",
    "-include",
    "cstdint",
    "-include",
    "ctime",
    ...includeFlags,
    "-c",
    source,
    "-o",
    object
  ]);
  objects.push(object);
}

const libDir = path.join(opensslPrefix, "lib");
const providerLibs = ["libdefault.a", "liblegacy.a"]
  .map((name) => path.join(libDir, name))
  .filter(existsSync);

run(tool("em++"), [
  ...objects,
  path.join(libDir, "libssl.a"),
  path.join(libDir, "libcrypto.a"),
  ...providerLibs,
  "-O3",
  "-o",
  path.join(outputDir, "zsign.mjs"),
  "-sMODULARIZE=1",
  "-sEXPORT_ES6=1",
  "-sEXPORT_NAME=createZsignModule",
  "-sENVIRONMENT=web,worker",
  "-sINVOKE_RUN=0",
  "-sEXIT_RUNTIME=0",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sINITIAL_MEMORY=67108864",
  "-sFORCE_FILESYSTEM=1",
  "-sEXPORTED_RUNTIME_METHODS=['callMain','FS','WORKERFS','IDBFS']",
  "-lidbfs.js",
  "-lworkerfs.js"
]);

console.log("WASM build complete: public/wasm/zsign.mjs");

