// The module plugin.ts serves in the UI Workbench's dev server; typed in index.ts
// (an ambient module can't import ./types.ts by a relative path).
declare module "virtual:workbench-catalog" {
  export const catalog: unknown;
  export const loaders: Record<string, () => Promise<Record<string, unknown>>>;
}
