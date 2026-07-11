declare module "node:child_process" {
  export function execFileSync(
    command: string,
    args?: readonly string[],
    options?: { input?: string; encoding?: "utf8" | "utf-8" },
  ): string;

  export function spawnSync(
    command: string,
    args?: readonly string[],
  ): { status: number | null };
}

declare module "node:fs" {
  export function mkdtempSync(prefix: string): string;
  export function readFileSync(path: string, encoding: "utf8" | "utf-8"): string;
  export function rmSync(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): void;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
}
