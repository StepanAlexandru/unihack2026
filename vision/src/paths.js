import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the /vision package. */
export const VISION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Absolute path of the repository root. */
export const REPO_ROOT = path.resolve(VISION_DIR, "..");

/**
 * CLI scripts only: load the repo-root .env if it exists (CLAUDE.md §5).
 * The library (index.js) never loads .env; Module 4 owns process configuration.
 */
export function loadRootEnv() {
  const envPath = path.join(REPO_ROOT, ".env");
  if (existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }
}

/** Resolve a user-supplied CLI path against the shell's cwd (npm runs scripts from /vision). */
export function resolveUserPath(p) {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), p);
}
