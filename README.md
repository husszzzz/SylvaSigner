# zsign WASM

Browser-first WebAssembly port of [`zhlynn/zsign`](https://github.com/zhlynn/zsign) for local IPA signing in desktop Chromium.

## Quick Start

```powershell
npm install
npm run setup:emsdk
npm run build:openssl
npm run build:wasm
npm run wasm:smoke
npm run dev
```

Open the Vite URL, choose an IPA plus signing assets, and run the signer. Private key material stays inside the browser worker.

## Scripts

- `npm run setup:emsdk` installs Emscripten `6.0.0` into `tools/emsdk`.
- `npm run build:openssl` builds OpenSSL `3.5.7` LTS as a static WASM dependency.
- `npm run build:wasm` compiles the vendored zsign core to `public/wasm/zsign.mjs`.
- `npm run wasm:smoke` runs `zsign -v` against the generated WASM module.
- `npm run build` type-checks and builds the Vite app.
- `npm run test:e2e` runs the Chromium Playwright checks.

## Browser Limits

The app is fully local and does not upload signing material. Browser-only mode cannot run `ideviceinstaller` or zsign's raw-socket live OCSP path, so those operations return explicit unsupported errors.

See [docs/UPSTREAM.md](docs/UPSTREAM.md) and [docs/WASM_BUILD.md](docs/WASM_BUILD.md).

