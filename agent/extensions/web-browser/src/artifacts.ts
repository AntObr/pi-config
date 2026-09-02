import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function safeName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "artifact";
}

export async function writeArtifact(options: {
  artifactDir: string;
  sessionName: string;
  kind: string;
  extension: string;
  content: string | Buffer;
}): Promise<string> {
  await mkdir(options.artifactDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${stamp}-${safeName(options.sessionName)}-${safeName(options.kind)}.${options.extension}`;
  const filePath = path.join(options.artifactDir, fileName);
  await writeFile(filePath, options.content);
  return filePath;
}

export async function maybeTruncateToArtifact(options: {
  content: string;
  maxChars: number;
  artifactDir: string;
  sessionName: string;
  kind: string;
}): Promise<{ text: string; truncated: boolean; artifactPath?: string }> {
  if (options.content.length <= options.maxChars) return { text: options.content, truncated: false };
  const artifactPath = await writeArtifact({
    artifactDir: options.artifactDir,
    sessionName: options.sessionName,
    kind: options.kind,
    extension: "html",
    content: options.content,
  });
  return {
    text: `${options.content.slice(0, options.maxChars)}\n\n[HTML truncated after ${options.maxChars} characters. Full HTML saved to ${artifactPath}]`,
    truncated: true,
    artifactPath,
  };
}
