# Third-Party Notices

Sylva Signer's original source code is licensed under the repository's MIT
License. Third-party software and assets remain under their respective
licenses. This file is an attribution and compliance index, not a replacement
for those license texts.

## Bundled native and WebAssembly components

| Component | Use | License and notice location |
| --- | --- | --- |
| [zhlynn/zsign](https://github.com/zhlynn/zsign) | iOS signing core, vendored at commit `28a6421` and patched for WebAssembly | MIT; `vendor/zsign/LICENSE` |
| zlib | Compression code vendored within upstream zsign | zlib License; copyright and terms retained in `vendor/zsign/src/third-party/zlib/zlib.h` |
| minizip | ZIP handling vendored within upstream zsign | zlib/minizip terms; notices retained in `vendor/zsign/src/third-party/minizip/` |
| [OpenSSL 3.5.7](https://www.openssl.org/) | Static cryptographic dependency linked into the WASM runtime | Apache-2.0; `licenses/openssl-3.5.7.txt` |
| [Emscripten 6.0.0](https://emscripten.org/) | Build toolchain used to produce the committed JavaScript/WASM runtime | MIT and University of Illinois/NCSA terms; Emscripten is fetched by the reproducible build scripts, not vendored as source |

The committed `public/wasm/zsign.mjs` and `public/wasm/zsign.wasm` are object
forms built from these components. Source and build instructions are included
in this repository.

## Fonts and artwork

- [Inter](https://github.com/rsms/inter) is distributed under the SIL Open
  Font License 1.1. The exact text is at `public/fonts/inter/OFL.txt`.
- `public/icon-light.png` and `public/icon-dark.png` are Sylva Signer project
  branding and are distributed with this project under the repository MIT
  License. Do not use them to imply endorsement by Apple, zsign, Litterbox, or
  any other third party.
- Apple names, iPhone, iOS, and related marks belong to Apple Inc. Sylva Signer
  is an independent project and is not affiliated with or endorsed by Apple.

## JavaScript packages

Direct runtime and development dependencies are listed with their licenses in
the README. Exact license texts shipped by direct runtime packages are copied
under `licenses/npm/`. Transitive package versions and integrity hashes are
recorded in `package-lock.json`; their license files are installed alongside
them by `npm install`.

## Copied interface components

[Animate UI](https://animate-ui.com/) by Elliot Sutton provides the animated
icon wrappers, animations, and related primitives under
`src/components/animate-ui/`. These files are used and distributed as part of
the Sylva Signer application, not as a standalone component library. Animate
UI's MIT plus Commons Clause license is preserved at
`licenses/animate-ui.txt`, and a source notice is kept beside the components at
`src/components/animate-ui/NOTICE.md`. The icon geometry is based on Lucide;
Lucide and Feather-derived notices are preserved at
`licenses/npm/lucide-react.txt`.

## External services

Litterbox/Catbox and Palera are optional external services, not bundled
software. Their names identify the services used by the opt-in temporary
installation flow and do not imply sponsorship or endorsement. Review their
current terms and privacy practices before operating a public deployment.

## Maintainer note

Before publishing a release, run `npm audit`, verify that this notice still
matches `package.json`, and preserve all files under `licenses/`,
`public/fonts/inter/OFL.txt`, and `vendor/zsign/LICENSE` in source
distributions.
