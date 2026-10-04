import process from "node:process";

/** Optional local .env, never required by a cloud Worker or committed to Git. */
export function loadLocalEnvironment() {
  if (typeof process.loadEnvFile !== "function") return;
  try { process.loadEnvFile(".env"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
