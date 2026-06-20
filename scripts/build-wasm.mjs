import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
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
const objDir = path.join(buildDir, "wasm");
const selectedVariant = process.env.ZSIGN_WASM_VARIANT ?? "all";
const debugBuild = process.env.ZSIGN_WASM_DEBUG === "1";

if (!["all", "memory", "opfs"].includes(selectedVariant)) {
  throw new Error("ZSIGN_WASM_VARIANT must be all, memory, or opfs.");
}

if (!existsSync(opensslLib)) {
  throw new Error("OpenSSL WASM libs are missing. Run `npm run build:openssl` first.");
}

if (selectedVariant === "all") {
  rmSync(objDir, { recursive: true, force: true });
}
mkdirSync(objDir, { recursive: true });
mkdirSync(outputDir, { recursive: true });

function files(dir, ext) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(ext))
    .map((name) => path.join(dir, name));
}

function shouldCompile(source, object) {
  return !existsSync(object) || statSync(source).mtimeMs > statSync(object).mtimeMs;
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
const cObjects = [];
const cObjDir = path.join(objDir, "c");
mkdirSync(cObjDir, { recursive: true });

for (const source of cSources) {
  const object = path.join(cObjDir, `${path.basename(source, ".c")}.o`);
  if (shouldCompile(source, object)) {
    run(tool("emcc"), ["-O3", "-Wno-unused-result", ...includeFlags, "-c", source, "-o", object]);
  }
  cObjects.push(object);
}

function compileCppVariant(name, extraFlags = []) {
  const variantDir = path.join(objDir, name);
  mkdirSync(variantDir, { recursive: true });
  const objects = [];
  for (const source of cppSources) {
    const object = path.join(variantDir, `${path.basename(source, ".cpp")}.o`);
    if (shouldCompile(source, object)) run(tool("em++"), [
      "-std=c++11",
      "-O3",
      "-Wno-unused-result",
      "-DZSIGN_VERSION=wasm_28a6421",
      ...extraFlags,
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
  return [...cObjects, ...objects];
}

const libDir = path.join(opensslPrefix, "lib");
const providerLibs = ["libdefault.a", "liblegacy.a"]
  .map((name) => path.join(libDir, name))
  .filter(existsSync);

function linkVariant(objects, outputName, extraFlags) {
  const linkDir = path.join(objDir, "linked", path.basename(outputName, ".mjs"));
  rmSync(linkDir, { recursive: true, force: true });
  mkdirSync(linkDir, { recursive: true });
  const stagedOutput = path.join(linkDir, outputName);
  run(tool("em++"), [
    ...objects,
    path.join(libDir, "libssl.a"),
    path.join(libDir, "libcrypto.a"),
    ...providerLibs,
    "-O3",
    "-o",
    stagedOutput,
    "-sMODULARIZE=1",
    "-sEXPORT_ES6=1",
    "-sEXPORT_NAME=createZsignModule",
    "-sENVIRONMENT=web,worker",
    "-sINVOKE_RUN=0",
    "-sEXIT_RUNTIME=0",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sINITIAL_MEMORY=67108864",
    "-sFORCE_FILESYSTEM=1",
    ...(debugBuild ? ["-sASSERTIONS=2", "--profiling-funcs"] : []),
    ...extraFlags
  ]);
  copyFileSync(stagedOutput, path.join(outputDir, outputName));
  copyFileSync(
    stagedOutput.replace(/\.mjs$/, ".wasm"),
    path.join(outputDir, outputName.replace(/\.mjs$/, ".wasm"))
  );
}

if (selectedVariant !== "opfs") {
  const memoryObjects = compileCppVariant("memory");
  linkVariant(memoryObjects, "zsign.mjs", [
    "-sEXPORTED_RUNTIME_METHODS=['callMain','FS','WORKERFS','IDBFS']",
    "-lidbfs.js",
    "-lworkerfs.js"
  ]);
}

if (selectedVariant !== "memory") {
  const opfsObjects = compileCppVariant("opfs", ["-DZSIGN_WASM_OPFS=1"]);
  linkVariant(opfsObjects, "zsign-opfs.mjs", [
    "-sWASMFS=1",
    "-sASYNCIFY=1",
    "-sSTACK_SIZE=2097152",
    "-sEXPORTED_RUNTIME_METHODS=['callMain','ccall']",
    "-lopfs.js"
  ]);
}

console.log("WASM builds complete: public/wasm/zsign.mjs and public/wasm/zsign-opfs.mjs");
