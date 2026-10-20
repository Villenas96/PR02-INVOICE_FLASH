/**
 * Subset of Vite's `import.meta.glob` (transformed by Vitest at build time)
 * used by the permission-matrix suite; `vite` is not a direct dependency.
 */
interface ImportGlobOptions {
  query?: string;
  import?: string;
}

interface ImportMeta {
  glob<Module>(
    pattern: string,
    options: ImportGlobOptions & { eager: true },
  ): Record<string, Module>;
  glob<Module>(
    pattern: string,
    options?: ImportGlobOptions & { eager?: false },
  ): Record<string, () => Promise<Module>>;
}
