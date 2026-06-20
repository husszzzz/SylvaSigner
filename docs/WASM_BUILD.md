# WASM Build

The browser build uses Emscripten `6.0.0` and OpenSSL `3.5.7` LTS.

```powershell
npm install
npm run setup:emsdk
npm run build:openssl
npm run build:wasm
npm run wasm:smoke
npm run build
```

The build emits two runtime variants:

- `public/wasm/zsign.mjs` and `zsign.wasm`: WORKERFS input with MEMFS working files.
- `public/wasm/zsign-opfs.mjs` and `zsign-opfs.wasm`: experimental WasmFS/OPFS working
  files; this variant is not selected automatically.

Set `ZSIGN_WASM_VARIANT` to `memory` or `opfs` to rebuild one variant incrementally
during development. The default `all` build starts from clean objects and produces both.

The OPFS build uses Asyncify because WasmFS storage operations are asynchronous. Its
entry point is invoked through an async `ccall` wrapper, and its C stack is enlarged for
archive traversal. Emscripten links in a staging directory before publishing completed
artifacts so a running Vite server cannot race the optimizer on Windows.

The worker uses `@zip.js/zip.js` to stream IPA entries through browser decompression APIs
into MEMFS for fast synchronous signing. It then
passes the extracted folder to upstream zsign with the original output and compression
arguments intact. zsign's minizip implementation creates the final IPA, preserving its
file ordering, headers, directory records, attributes, and CLI behavior.

The web app keeps signing local to the browser worker. `-i/--install` and live OCSP socket checks are intentionally unsupported in browser-only mode.
