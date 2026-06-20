<p align="center">
  <img src="public/icon-dark.png" alt="Sylva Signer" width="128" />
</p>

<h1 align="center">Sylva Signer</h1>

<p align="center">
  A privacy-focused proof of concept for signing IPA files locally in a browser.
</p>

Sylva Signer runs a WebAssembly port of
[`zhlynn/zsign`](https://github.com/zhlynn/zsign) inside a dedicated Web Worker.
Signing does not require an upload or signing server: the IPA, certificate, provisioning
profile, password, injected dylibs, and signed output are processed on the user's device.

An optional post-sign installation flow can temporarily upload **only the signed IPA**
to [Litterbox](https://litterbox.catbox.moe/) and generate an iOS installation manifest
through Palera. This action is separate from local signing and requires explicit user
confirmation.

Made by [AntonP29](https://github.com/AntonP29). Project status: June 17, 2026.

## Features

- Local IPA signing with zsign compiled to WebAssembly.
- Dedicated browser worker so signing does not block the interface.
- Automatic low-memory browser-storage mode for mobile devices and large IPAs.
- Streaming ZIP extraction/creation with bounded parallel decompression and native
  browser compression streams when available.
- Live, internally scrolling zsign console output.
- Transient animated `WAIT` status with byte-based percentage during extraction and
  archive compression, making long local operations visibly active without polluting logs.
- Signing-stage progress based on zsign log milestones.
- IPA, P12/PFX, provisioning profile, optional dylib, password, output name, and bundle
  ID controls.
- Output names default to the input name with `_signed` appended.
- Signed IPAs use browser-native ZIP compression by default to avoid the large output
  inflation caused by uncompressed (`-z 0`) archives.
- Optional P12/profile/password cache stored in browser IndexedDB.
- Cached signing files and password are restored into the visible controls on reload.
- Browser-local `Previous IPAs` history with `Fully Local`, `Active`, and `Expired`
  states.
- Local download of the signed IPA.
- Optional QR/direct iPhone install flow using Litterbox and Palera.
- Temporary hosting choices of `1h`, `12h`, `24h`, or `72h`.
- Responsive light/dark interface, animated controls, matching favicons, and a bundled
  local welcome animation.
- Privacy Policy and Legal pages in the footer.

The public UI intentionally focuses on the common signing workflow. Lower-level zsign
options remain available through the TypeScript API and worker wrapper.

## Privacy Model

### Local signing

The following remain on the device during normal signing and local download:

- Original IPA
- P12/PFX certificate and private key material
- Provisioning profile
- Certificate password
- Injected dylibs
- Signed IPA output

The app downloads its code and WASM runtime from the host, then executes zsign in the
browser worker. Use a deployment and domain you trust.

### Optional certificate cache

When `Cache certificate locally` is enabled, the certificate, provisioning profiles,
and password are saved in this browser's IndexedDB. This data is not uploaded by Sylva
Signer, but it is also not separately encrypted by the app. Do not enable caching on a
shared or untrusted browser profile. `Forget cached certificate` removes the saved data.

### Previous IPA history

History is stored in browser `localStorage` and keeps:

- Signed output name and signing time
- Detected bundle metadata when available
- Temporary IPA/manifest/install URLs when QR installation was used
- Selected temporary-host duration and calculated expiration time

Signed IPA bytes are **not** retained in history. A `Fully Local` entry therefore has no
copy-link actions and cannot be downloaded again after the in-memory output is gone.
`Active` and `Expired` are calculated locally from the selected duration; Sylva does not
poll Litterbox to verify remote file availability.

### Optional QR installation

QR installation is not fully local. After confirmation:

1. The already-signed IPA is uploaded directly from the browser to Litterbox over HTTPS.
2. The original IPA, P12, provisioning profile, password, and dylibs are not uploaded.
3. Sylva sends app metadata and the temporary IPA URL to Palera's manifest generator.
4. Sylva renders an `itms-services://` QR code and direct iPhone install link.

The temporary IPA URL is public to anyone who possesses it until it expires. Litterbox
accepts files up to **1 GB**; Sylva rejects larger upload attempts before sending them.

## Browser Workflow

1. Open Sylva Signer and review the welcome notice.
2. Select an `.ipa` file.
3. Select a `.p12` or `.pfx` signing certificate.
4. Select one or more `.mobileprovision` files.
5. Enter the certificate password.
6. Optionally select dylibs to inject or enter a replacement bundle ID.
7. Optionally enable local certificate caching.
8. Click `Sign IPA` and keep the tab open while the worker runs.
9. Download the signed IPA locally.
10. Optionally choose `Install QR`, review the limitations, and approve temporary
    hosting.

Large IPAs can still take significant time because extraction, signing, and re-archiving
use the device's CPU and storage. Sylva streams ZIP entries through browser compression
APIs and uses bounded parallel extraction. Devices reporting 4 GB of memory or less,
mobile browsers that do not expose memory information, and IPAs of at least 256 MB use
Origin Private File System (OPFS) storage for lower peak memory use. Keep the tab open
and ensure the device has enough free browser storage for the extracted app and signed
output.

In a local Chromium comparison using a 93.06 MB IPA with 10,691 ZIP entries (about
233 MB extracted), the previous zsign ZIP path took 282.8 seconds end-to-end. The
streaming path completed in 50.3 seconds: 20.6 seconds extraction, 8.1 seconds signing,
and 21.5 seconds archiving. Results vary by device and IPA structure.

The signed IPA may still differ modestly in size from the input because Mach-O code
signature regions can grow and the archive is recompressed. It should no longer exhibit
the much larger inflation caused by an uncompressed ZIP output.

## Previous IPAs

The `Previous IPAs` button beside the theme control opens local signing history.

- `Fully Local`: the IPA was signed but never temporarily hosted. No URL buttons appear.
- `Active`: the locally calculated Litterbox expiration time has not passed.
- `Expired`: the selected Litterbox duration has elapsed.
- `Copy Download URL`: copies the temporary Litterbox IPA URL.
- `Copy iPhone Install Link`: copies the generated `itms-services://` link.

Clearing history removes these local records and URLs. It does not control files already
uploaded to Litterbox.

## QR Install Limitations

- Maximum temporary upload size is 1 GB.
- Temporary durations are controlled by Litterbox.
- The signed IPA is publicly accessible to anyone with its temporary URL.
- Installation depends on Litterbox, Palera, Apple OTA behavior, device trust, and the
  signing certificate/provisioning profile.
- Some networks or regions may block Catbox/Litterbox.
- The upload bar is intentionally indeterminate. Browser upload progress listeners force
  a CORS preflight that Litterbox does not reliably accept; plain multipart upload works
  without that preflight.
- Blob URLs and localhost URLs are not suitable for installation on a separate iPhone.

## Quick Start

Requirements:

- Node.js with npm
- Current Chromium-based browser recommended; Android Chromium is supported

```powershell
npm install
npm run dev
```

Open the Vite URL, normally:

```text
http://localhost:5173
```

The committed WASM runtime is sufficient for normal development. You do not need to
install Emscripten or rebuild OpenSSL to run the app from a fresh clone.

## Production Build

```powershell
npm install
npm run build
```

Deploy the generated `dist/` directory to an HTTPS static host.

Recommended Vercel settings:

```text
Framework Preset: Vite
Install Command: npm install
Build Command: npm run build
Output Directory: dist
```

Required content types:

```text
.wasm    application/wasm
.js/.mjs text/javascript or application/javascript
```

No application backend is required for signing. Network access is used only for loading
the hosted static app and for the explicitly approved QR installation flow.

## TypeScript Interfaces

The worker API is available in [`src/zsign-api.ts`](src/zsign-api.ts):

- `runZsign(args, files, options)` runs zsign-style arguments against browser files and
  returns logs, exit code, and collected output files.
- `signIpa(options, runOptions)` provides the higher-level IPA signing interface.
- `saveOutput(output)` downloads a returned output file through the browser.

`SignIpaOptions` retains the broader zsign option surface even though the main interface
shows only the common workflow.

## Rebuilding WASM

Committed runtime files:

```text
public/wasm/zsign.mjs
public/wasm/zsign.wasm
public/wasm/zsign-opfs.mjs
public/wasm/zsign-opfs.wasm
```

Rebuild only when zsign, OpenSSL, Emscripten, or the browser patches change:

```powershell
npm install
npm run setup:emsdk
npm run build:openssl
npm run build:wasm
npm run wasm:smoke
npm run build
```

Pinned inputs:

- Emscripten `6.0.0`
- OpenSSL `3.5.7`
- zsign commit `28a6421`

The standard build uses `WORKERFS` for certificate inputs, MEMFS for synchronous signing,
and `IDBFS` for the persistent zsign cache. ZIP data is streamed into and out of MEMFS by
the browser rather than zsign's native ZIP loop. The low-memory build uses WasmFS with
OPFS and Asyncify so extracted app contents remain in browser-managed storage.
Browser-specific patches and upstream details are documented in
[`docs/UPSTREAM.md`](docs/UPSTREAM.md) and [`docs/WASM_BUILD.md`](docs/WASM_BUILD.md).

## Verification

```powershell
npm run build
npm run wasm:smoke
npm run test:e2e
```

The Playwright suite verifies the Sylva work surface, welcome notice, local asset loading,
output naming, footer pages, and Previous IPAs panel without external requests during
normal page load.

## Browser and Platform Limits

- Current Chromium is the primary browser target on desktop and Android.
- Lower-memory devices and IPAs of at least 256 MB use OPFS automatically when the
  browser supports it, with an automatic fallback to memory mode if setup fails.
- iOS browsers use Apple's WebKit engine even when branded as Chrome. The pinned
  Emscripten OPFS backend is not currently treated as a reliable iOS path, so large IPA
  signing on iPhone/iPad remains more constrained than Android Chromium.
- Large IPA performance depends on device CPU, memory, storage, and browser limits.
- ZIP progress is byte-based; signing progress between extraction and archiving is
  estimated from zsign log stages.
- Litterbox upload progress is indeterminate for CORS compatibility.
- Native `-i/--install` through `ideviceinstaller` is unsupported in browser-only mode.
- Raw-socket live OCSP checks are unsupported in browser WebAssembly.
- Native `system()` operations are stubbed as unsupported.
- Third-party OTA installation can fail even when signing succeeds.

## Security Notes

- Real signing material and IPA files are excluded by `.gitignore` and must not be
  committed.
- Only synthetic fixtures should be placed in `tests/fixtures/`.
- Browser storage persists until cleared by the app, browser settings, or profile reset.
- A private source repository does not make hosted client assets secret. Visitors can
  download the JavaScript, `zsign.mjs`, and `zsign.wasm` required by their browser.
- Minification or WASM obfuscation cannot prevent a visitor from saving client assets.
- Use only certificates, profiles, dylibs, and applications you are authorized to use.

## Repository Layout

```text
src/                       React UI, worker, zsign API, history, and install helpers
src/components/            Sylva components, UI primitives, and animated icons
public/wasm/               Committed zsign WASM runtime
public/fonts/              Bundled SF Pro Display font files
public/*.png               App icons and favicons
public/*.lottie            Bundled welcome animation
public/dotlottie-player.wasm  Local DotLottie runtime; no CDN is required
scripts/                   Emscripten, OpenSSL, zsign build, and smoke-test scripts
vendor/zsign/              Vendored upstream zsign source and MIT license
docs/                      Upstream and WASM build documentation
tests/e2e/                 Playwright browser tests
tests/fixtures/            Synthetic test fixtures only
```

## Attribution

- Powered by [`zsign`](https://github.com/zhlynn/zsign), with a privacy-focused WebAssembly
  port for this browser proof of concept.
- Optional temporary IPA hosting is provided by
  [Litterbox](https://litterbox.catbox.moe/).
- Created by [AntonP29](https://github.com/AntonP29).

See the in-app Privacy Policy and Legal pages before using Sylva Signer for distribution
workflows.
