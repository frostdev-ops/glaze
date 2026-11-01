# QuickJS for run_js

run_js's engine (extension/ai/agent/js.js): QuickJS compiled to WebAssembly by quickjs-emscripten, MIT (quickjs.LICENSE).
Rebuild with `bash tools/build/vendor-quickjs.sh`; the output must match the sha256 below.

Source: https://github.com/justjake/quickjs-emscripten (npm), version 0.32.0, packed 2026-02-16.

| Package | Tarball sha256 |
| --- | --- |
| quickjs-emscripten-core@0.32.0 | 2ea4461a54e87217adf3f2b327c130d8f6b034e334f9e7d87c0580d0406a206e |
| @jitl/quickjs-wasmfile-release-sync@0.32.0 | 8459053841d6b053207b70287b5a6d762fd5608a3908b40956c5aa3178dcf9c8 |
| @jitl/quickjs-ffi-types@0.32.0 | d7bf18745d8fb2144587fcfd15982a1a87347f6675538615623c3267c51965b1 |

quickjs.js: the core bundled with the release-sync variant by esbuild 0.28.2 (IIFE, minified, setting GZ_QUICKJS: load(wasmBinary, wasmMemory)).
quickjs.wasm: the variant's dist/emscripten-module.wasm, unchanged. quickjs.LICENSE: the variant's LICENSE, unchanged.

```
475e9635f55e52e130097ac9d91e01566870fa719a087e7244d7b5c96a50840a  quickjs.js
105c3bed22d457e43e3d1c3c1c6959fda62a8fe06f0fc8a985303c3a2be72232  quickjs.wasm
```
