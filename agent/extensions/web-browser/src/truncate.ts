export const MAX_TOOL_BYTES = 50 * 1024;
export const MAX_TOOL_LINES = 2_000;

export type TruncatedText = {
  content: string;
  truncated: boolean;
  originalBytes: number;
  originalLines: number;
};

export function truncateForTool(text: string, maxBytes = MAX_TOOL_BYTES, maxLines = MAX_TOOL_LINES): TruncatedText {
  const lines = text.split(/\r?\n/);
  const originalBytes = Buffer.byteLength(text, "utf8");
  const originalLines = lines.length;

  let output = "";
  let bytes = 0;
  let lineCount = 0;

  for (const line of lines) {
    const next = lineCount === 0 ? line : `\n${line}`;
    const nextBytes = Buffer.byteLength(next, "utf8");
    if (lineCount >= maxLines) break;
    if (bytes + nextBytes > maxBytes) {
      const remaining = maxBytes - bytes;
      if (remaining > 0) output += Buffer.from(next, "utf8").subarray(0, remaining).toString("utf8");
      break;
    }
    output += next;
    bytes += nextBytes;
    lineCount += 1;
  }

  return {
    content: output,
    truncated: output.length !== text.length,
    originalBytes,
    originalLines,
  };
}
