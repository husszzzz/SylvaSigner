# WASM Build

The generated runtime combines MIT-licensed zsign, zlib/minizip components,
and Apache-2.0-licensed OpenSSL. Keep `vendor/zsign/LICENSE`,
`licenses/openssl-3.5.7.txt`, and `THIRD_PARTY_NOTICES.md` with public source
and binary distributions.

The browser build uses Emscripten `6.0.0` and OpenSSL `3.5.7` LTS.

```powershell
npm install
npm run setup:emsdk
npm run build:openssl
npm run build:wasm
npm run wasm:smoke
npm run build
```

The build emits three runtime variants:

- `public/wasm/zsign.mjs` and `zsign.wasm`: fast desktop browser extraction with MEMFS
  working files.
- `public/wasm/zsign-mobile.mjs`, `zsign-mobile.js`, and `zsign-mobile.wasm`: 16.625 MiB
  initial heap, 512 MiB maximum heap, WORKERFS IPA input, and upstream native archive
  operations for experimental mobile use. The classic `.js` loader is used by mobile.
- `public/wasm/zsign-opfs.mjs` and `zsign-opfs.wasm`: experimental WasmFS/OPFS working
  files; this variant is not selected automatically.

Set `ZSIGN_WASM_VARIANT` to `memory`, `mobile`, or `opfs` to rebuild one variant
incrementally during development. The default `all` build starts from clean objects and
produces all three.

The OPFS build uses Asyncify because WasmFS storage operations are asynchronous. Its
entry point is invoked through an async `ccall` wrapper, and its C stack is enlarged for
archive traversal. Emscripten links in a staging directory before publishing completed
artifacts so a running Vite server cannot race the optimizer on Windows.

The worker uses `@zip.js/zip.js` to stream IPA entries through browser decompression APIs
into MEMFS for fast synchronous signing. It then
passes the extracted folder to upstream zsign with the original output and compression
arguments intact. zsign's minizip implementation creates the final IPA, preserving its
file ordering, headers, directory records, attributes, and CLI behavior.

Mobile compatibility mode bypasses browser ZIP extraction and the general module worker.
`public/mobile-zsign-worker.js` is a minimal classic worker which imports only the
Emscripten runtime. The IPA remains a Blob mounted through WORKERFS while zsign's minizip
code streams it into MEMFS. Output is returned by transferring the MEMFS file's owned
typed-array buffer, avoiding `FS.readFile` and its full output copy. Mobile callers wrap
that buffer once as a browser-managed Blob reused by download and temporary upload. The
worker is terminated as soon as the result is delivered.

The web app keeps signing local to the browser worker. `-i/--install` and live OCSP socket checks are intentionally unsupported in browser-only mode.
