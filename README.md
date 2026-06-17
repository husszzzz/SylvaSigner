# Sylva Signer

Modern desktop-Chromium web app for fully local IPA signing in the browser.

Sylva Signer runs a WebAssembly build of [`zhlynn/zsign`](https://github.com/zhlynn/zsign)
inside a dedicated browser worker. IPA files, signing certificates, provisioning
profiles, passwords, injected dylibs, and signed output remain on the local device.
The optional QR install flow is separate: after signing, the user can explicitly upload
only the signed IPA to temporary HTTPS hosting so an iPhone can download it.

Made by [AntonP29](https://github.com/AntonP29).

## Current Status

- Fully local browser signing with zsign compiled to WebAssembly.
- Modern React/Vite frontend adapted from the Sylva Signer UI design.
- Live signing logs stream during the signing process.
- Simplified main workflow: IPA, P12/PFX, provisioning profiles, optional dylibs,
  password, output IPA name, bundle ID, local cert cache, logs, and local download.
- Optional certificate/profile/password cache stored in browser IndexedDB.
- Optional post-sign QR install flow using temporary Litterbox hosting plus Palera's
  manifest generator.
- Privacy Policy and Legal pages are included in the app footer.
- Generated WASM runtime files are committed under `public/wasm/` so a fresh clone can
  run without rebuilding Emscripten/OpenSSL first.

## What "Fully Local" Means

- No signing server is required.
- zsign executes inside a browser Web Worker.
- Private key material does not need to leave the browser.
- Signed IPA output is produced as a local browser download.
- Optional cache data is stored only in this browser's local IndexedDB storage.

The QR install flow is opt-in and not fully local. It uploads only the already-signed
IPA to Litterbox temporarily so iOS can fetch the file over HTTPS. The certificate,
provisioning profile, password, and original local inputs are not uploaded by Sylva
Signer for that flow.

Important trust note: if you use a hosted copy, your browser still downloads the app
code from that host. Use a domain and build you trust.

## Quick Start

```powershell
npm install
npm run dev
```

Open the Vite URL, usually:

```text
http://localhost:5173
```

## Normal Use

1. Choose an IPA.
2. Choose a P12/PFX signing certificate.
3. Choose one or more `.mobileprovision` files.
4. Enter the P12 password.
5. Optional: choose dylibs to inject.
6. Optional: enter a new bundle ID.
7. Optional: enable `Cache certificate info locally`.
8. Click `Sign IPA`.
9. Download the signed IPA from the output panel.

The output name defaults to the input IPA name with `_signed` appended.

## Optional QR Install

After signing succeeds, `Install QR` opens a confirmation dialog. The short disclaimer
can be clicked to show the limitations before any upload happens.

When the user clicks `Create QR`:

1. The signed IPA is uploaded to Litterbox with a temporary expiration.
2. Sylva builds a Palera manifest URL from the signed IPA URL and detected app metadata.
3. The app renders an `itms-services://` QR code and direct install link.

Limitations:

- This path is not fully local because the signed IPA is temporarily hosted.
- The temporary IPA URL is public while active; do not share it casually.
- Install success depends on Litterbox, Palera's manifest service, Apple OTA behavior,
  and a certificate/provisioning profile trusted by the target device.
- Some networks or regions may block Catbox/Litterbox.

## Static Hosting

Build the static web app:

```powershell
npm run build
```

Host the generated `dist/` directory on an HTTPS static host such as Vercel.

Recommended Vercel settings:

```text
Framework Preset: Vite
Install Command: npm install
Build Command: npm run build
Output Directory: dist
```

The host must serve:

```text
.wasm -> application/wasm
.js/.mjs -> text/javascript or application/javascript
```

## Rebuilding WASM

The committed `public/wasm/zsign.mjs` and `public/wasm/zsign.wasm` are enough for normal
development and static hosting. Rebuild only when zsign, OpenSSL, or the Emscripten
build scripts change.

```powershell
npm run setup:emsdk
npm run build:openssl
npm run build:wasm
npm run wasm:smoke
```

Pinned build inputs:

- Emscripten `6.0.0`
- OpenSSL `3.5.7`
- zsign upstream commit documented in `docs/UPSTREAM.md`

## Verification

```powershell
npm run build
npm run wasm:smoke
npm run test:e2e
```

## Repository Layout

```text
src/                 React/Vite app, UI, zsign API wrapper, worker
src/components/      Animated icon pack and UI support code
public/wasm/         Committed zsign WASM runtime used by the browser app
scripts/             Emscripten/OpenSSL/zsign build and smoke-test scripts
vendor/zsign/        Vendored upstream zsign source
docs/                Upstream and WASM build notes
tests/e2e/           Playwright browser checks
tests/fixtures/      Safe synthetic test fixtures only
```

## Security Hygiene

`.gitignore` intentionally excludes real signing material and user apps:

- `*.p12`, `*.pfx`
- `*.mobileprovision`, `*.provisionprofile`
- `*.ipa`
- private keys and cert-like local files

Only synthetic fixtures should live in `tests/fixtures/`.

## Browser Limits

Browser-only mode exposes the local signing workflow in the public UI. Lower-level
native device workflows and raw socket network checks remain out of scope for this
browser app.

See also:

- [docs/UPSTREAM.md](docs/UPSTREAM.md)
- [docs/WASM_BUILD.md](docs/WASM_BUILD.md)
