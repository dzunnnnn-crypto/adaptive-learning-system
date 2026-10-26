import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export function loadLocalEnv(projectRoot = process.cwd()) {
  const envPath = path.resolve(projectRoot, ".env.local");
  if (!fs.existsSync(envPath)) return false;
  process.loadEnvFile(envPath);
  return true;
}
