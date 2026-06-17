import { createHash } from "node:crypto";
import { copyFileSync, cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { buildDir, depsDir, emsdkDir, isWindows, jobs, makeCommand, rootDir, run, tool } from "./toolchain.mjs";

const version = "3.5.7";
const archiveName = `openssl-${version}.tar.gz`;
const sourceUrl = `https://www.openssl.org/source/${archiveName}`;
const sourceRoot = path.join(buildDir, "openssl-src", `openssl-${version}`);
const archivePath = path.join(buildDir, archiveName);
const installPrefix = path.join(depsDir, "openssl-wasm");
const libCrypto = path.join(installPrefix, "lib", "libcrypto.a");

mkdirSync(path.dirname(archivePath), { recursive: true });
mkdirSync(depsDir, { recursive: true });

function toMsysPath(filePath) {
  const normalized = path.resolve(filePath).replaceAll("\\", "/");
  return normalized.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

function writeArWrapper(wrapperPath, realAr) {
  writeFileSync(wrapperPath, `#!/usr/bin/env sh
set -u

if [ "$#" -lt 3 ] || [ "$#" -le 42 ]; then
  exec "${realAr}" "$@"
fi

flags="$1"
archive="$2"
shift 2

members="$(mktemp "\${TMPDIR:-.}/emar.XXXXXX")"
: > "$members"
for arg do
  printf '%s\\n' "$arg" >> "$members"
done

xargs -n 40 "${realAr}" "$flags" "$archive" < "$members"
status=$?
rm -f "$members"
exit "$status"
`);
}

async function download(url, target) {
  if (existsSync(target)) return;
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(target));
}

await download(sourceUrl, archivePath);

const digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
console.log(`OpenSSL archive sha256: ${digest}`);

if (!existsSync(sourceRoot)) {
  mkdirSync(path.dirname(sourceRoot), { recursive: true });
  run("tar", ["-xzf", archivePath, "-C", path.dirname(sourceRoot)], { cwd: rootDir });
}

if (!existsSync(libCrypto)) {
  const msysPerl = "C:/Program Files/Git/usr/bin/perl.exe";
  const perl = isWindows && existsSync(msysPerl) ? msysPerl : "perl";
  const configureArgs = [
    perl,
    "Configure",
    "gcc",
    "enable-legacy",
    "no-shared",
    "no-module",
    "no-tests",
    "no-apps",
    "no-asm",
    "no-dso",
    "no-engine",
    `--prefix=${installPrefix.replaceAll("\\", "/")}`,
    "--openssldir=/ssl"
  ];

  let buildEnv = {};
  if (isWindows && existsSync(msysPerl)) {
    const shimRoot = path.join(buildDir, "msys-perl-lib");
    const shimFile = path.join(shimRoot, "Locale", "Maketext", "Simple.pm");
    if (!existsSync(shimFile)) {
      mkdirSync(path.dirname(shimFile), { recursive: true });
      copyFileSync("C:/Strawberry/perl/lib/Locale/Maketext/Simple.pm", shimFile);
    }
    const extUtils = path.join(shimRoot, "ExtUtils");
    if (!existsSync(extUtils)) {
      cpSync("C:/Strawberry/perl/lib/ExtUtils", extUtils, { recursive: true });
    }
    const pod = path.join(shimRoot, "Pod");
    if (!existsSync(pod)) {
      cpSync("C:/Strawberry/perl/lib/Pod", pod, { recursive: true });
    }
    const podUsage = path.join(shimRoot, "Pod", "Usage.pm");
    if (!existsSync(podUsage)) {
      mkdirSync(path.dirname(podUsage), { recursive: true });
      copyFileSync("C:/Strawberry/perl/site/lib/Pod/Usage.pm", podUsage);
    }
    buildEnv = {
      PERL5LIB: path.relative(sourceRoot, shimRoot).replaceAll("\\", "/"),
      PATH: `C:\\Program Files\\Git\\usr\\bin;${process.env.PATH ?? ""}`
    };
  }

  const makePerl = perl.includes(" ") ? `PERL="${perl}"` : `PERL=${perl}`;

  run(tool("emconfigure"), configureArgs, { cwd: sourceRoot, env: buildEnv });
  const makefile = path.join(sourceRoot, "Makefile");
  let makefileText = readFileSync(makefile, "utf8")
    .replace(/^CROSS_COMPILE=.*$/m, "CROSS_COMPILE=");
  if (isWindows && existsSync(msysPerl)) {
    const llvmAr = path.join(emsdkDir, "upstream", "bin", "llvm-ar.exe");
    const toolOverrides = {
      CC: toMsysPath(tool("emcc")),
      CXX: toMsysPath(tool("em++")),
      AR: toMsysPath(path.join(buildDir, "openssl-emar-wrapper.sh")),
      RANLIB: toMsysPath(tool("emranlib"))
    };
    writeArWrapper(path.join(buildDir, "openssl-emar-wrapper.sh"), toMsysPath(existsSync(llvmAr) ? llvmAr : tool("emar")));
    for (const [name, executable] of Object.entries(toolOverrides)) {
      makefileText = makefileText.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${executable}`);
    }
    makefileText = makefileText.replace(
      /^\t\$\(AR\) \$\(ARFLAGS\) \S+\.a .+$/gm,
      "\t$(file >$@.members,$^)\n\ttr -d '\\r' < $@.members | xargs -n 40 $(AR) $(ARFLAGS) $@\n\t$(RM) $@.members"
    );
  }
  writeFileSync(makefile, makefileText);
  for (const generated of ["builddata.pm", "installdata.pm", "OpenSSLConfig.cmake", "OpenSSLConfigVersion.cmake"]) {
    rmSync(path.join(sourceRoot, generated), { force: true });
  }
  run(tool("emmake"), [makeCommand(), makePerl, `-j${jobs}`], { cwd: sourceRoot, env: buildEnv });
  run(tool("emmake"), [makeCommand(), makePerl, "install_sw"], { cwd: sourceRoot, env: buildEnv });
}

console.log(`OpenSSL WASM dependency is ready at ${path.relative(rootDir, installPrefix)}`);
