# Upstream zsign

This repository vendors `zhlynn/zsign` under `vendor/zsign`.

- Upstream: https://github.com/zhlynn/zsign
- Vendored commit: `28a6421`
- License: MIT, preserved at `vendor/zsign/LICENSE`

Local patches are intentionally small and browser-focused:

- Emscripten-safe file mapping in `src/common/fs.*`
- Browser unsupported stubs for raw-socket OCSP and `system()`
- Emscripten exclusion for the macOS-only `csreq` diagnostic `popen`
- `optind` reset before `main()` so repeated WASM invocations are deterministic

