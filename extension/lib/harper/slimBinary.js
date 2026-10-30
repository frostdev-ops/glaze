// harper.js 3.0.0 (Apache-2.0, lib/harper/LICENSE), as published on npm; source https://github.com/Automattic/harper/tree/v3.0.0/packages/harper.js. Built by scripts/vendor-harper.sh.
import { BinaryModuleImpl } from "./BinaryModule-S5UABkWQ.js";
const slimBinaryUrl = "" + new URL("harper_wasm_slim_bg.wasm", import.meta.url).href;
const slimBinary = /* @__PURE__ */ BinaryModuleImpl.create(slimBinaryUrl, "slim");
export {
  slimBinary
};
