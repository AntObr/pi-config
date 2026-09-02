function artifactTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeArtifactNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function rawHtmlArtifactFile(session: string): string {
  return `raw-html-${safeArtifactNamePart(session)}-${artifactTimestamp()}.html`;
}

export function screenshotArtifactFile(session: string): string {
  return `screenshot-${safeArtifactNamePart(session)}-${artifactTimestamp()}.png`;
}
