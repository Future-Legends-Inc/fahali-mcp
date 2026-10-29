import formatsModule from "ajv-formats";
import type { FormatsPlugin } from "ajv-formats";

// ajv-formats is CommonJS while this package emits Node16 ESM. Depending on
// whether the caller is TypeScript, tsx, or emitted Node, the callable plugin
// is either the imported value or its `default`. Resolve that boundary once so
// schema tests enforce formats in every execution mode.
const imported: unknown = formatsModule;
const candidate = typeof imported === "function"
  ? imported
  : (imported as { default?: unknown })?.default;

if (typeof candidate !== "function") {
  throw new TypeError("AJV_FORMATS_PLUGIN_NOT_CALLABLE");
}

export const addFahaliSchemaFormats = candidate as FormatsPlugin;
