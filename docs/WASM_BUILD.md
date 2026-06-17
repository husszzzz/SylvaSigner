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

Artifacts are emitted to `public/wasm/zsign.mjs` and `public/wasm/zsign.wasm`.

The web app keeps signing local to the browser worker. `-i/--install` and live OCSP socket checks are intentionally unsupported in browser-only mode.

