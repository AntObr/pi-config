import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserConfig } from "./config.js";
import { resolveArtifactsDir } from "./config.js";

export async function createArtifactPath(cwd: string, config: BrowserConfig, basename: string) {
  const dir = resolveArtifactsDir(cwd, config);
  await mkdir(dir, { recursive: true });
  return join(dir, basename);
}

export async function writeArtifact(cwd: string, config: BrowserConfig, basename: string, content: string | Buffer) {
  const path = await createArtifactPath(cwd, config, basename);
  await writeFile(path, content);
  return path;
}

export function timestampedName(prefix: string, extension: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${random}.${extension}`;
}
