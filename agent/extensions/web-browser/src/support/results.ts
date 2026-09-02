import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

import { rawHtmlArtifactFile } from "./artifacts.ts";
import {
  BrowserConfigError,
  BrowserInspectionError,
  BrowserInteractionError,
  BrowserRawHtmlError,
  BrowserScreenshotError,
  BrowserSessionModeConflictError,
  NavigationPolicyError,
} from "./errors.ts";
import type {
  BrowserClosedDetails,
  BrowserInstallRequiredDetails,
  BrowserInspectionUnavailableDetails,
  BrowserInteractionUnavailableDetails,
  BrowserRawHtmlDetails,
  BrowserRawHtmlUnavailableDetails,
  BrowserScreenshotUnavailableDetails,
  BrowserSessionModeConflictDetails,
  ConfigErrorDetails,
  NavigationDeniedDetails,
  BrowserInteractedDetails,
} from "./types.ts";
const RAW_HTML_RESPONSE_LIMIT_BYTES = 50_000;

export function textResult<TDetails>(text: string, details: TDetails): AgentToolResult<TDetails> {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

function configErrorResult(error: BrowserConfigError): AgentToolResult<ConfigErrorDetails> {
  return textResult(error.message, { status: "config_error", reason: error.message });
}

function navigationDeniedResult(error: NavigationPolicyError): AgentToolResult<NavigationDeniedDetails> {
  return textResult(error.message, { status: "denied", reason: error.message });
}

function browserInstallRequiredResult(error: Error): AgentToolResult<BrowserInstallRequiredDetails> {
  const message = `Chromium is not installed for Playwright. Run \`npx playwright install chromium\` and try again.`;
  return textResult(message, { status: "browser_install_required", reason: error.message });
}

function sessionModeConflictResult(error: BrowserSessionModeConflictError): AgentToolResult<BrowserSessionModeConflictDetails> {
  return textResult(error.message, { status: "session_mode_conflict", reason: error.message });
}

function inspectionUnavailableResult(error: BrowserInspectionError): AgentToolResult<BrowserInspectionUnavailableDetails> {
  return textResult(error.message, { status: "inspection_unavailable", reason: error.message });
}

function interactionUnavailableResult(error: BrowserInteractionError): AgentToolResult<BrowserInteractionUnavailableDetails> {
  return textResult(error.message, { status: "interaction_unavailable", reason: error.message });
}

function rawHtmlUnavailableResult(error: BrowserRawHtmlError): AgentToolResult<BrowserRawHtmlUnavailableDetails> {
  return textResult(error.message, { status: "raw_html_unavailable", reason: error.message });
}

function screenshotUnavailableResult(error: BrowserScreenshotError): AgentToolResult<BrowserScreenshotUnavailableDetails> {
  return textResult(error.message, { status: "screenshot_unavailable", reason: error.message });
}

export function toolErrorResult(
  error: unknown,
):
  | AgentToolResult<
      | ConfigErrorDetails
      | NavigationDeniedDetails
      | BrowserInstallRequiredDetails
      | BrowserSessionModeConflictDetails
      | BrowserInspectionUnavailableDetails
      | BrowserInteractionUnavailableDetails
      | BrowserRawHtmlUnavailableDetails
      | BrowserScreenshotUnavailableDetails
    >
  | undefined {
  if (error instanceof BrowserConfigError) return configErrorResult(error);
  if (error instanceof NavigationPolicyError) return navigationDeniedResult(error);
  if (error instanceof BrowserSessionModeConflictError) return sessionModeConflictResult(error);
  if (error instanceof BrowserInspectionError) return inspectionUnavailableResult(error);
  if (error instanceof BrowserInteractionError) return interactionUnavailableResult(error);
  if (error instanceof BrowserRawHtmlError) return rawHtmlUnavailableResult(error);
  if (error instanceof BrowserScreenshotError) return screenshotUnavailableResult(error);
  if (error instanceof Error && isMissingChromiumError(error)) return browserInstallRequiredResult(error);
  return undefined;
}

function isMissingChromiumError(error: Error): boolean {
  return /Executable doesn't exist|playwright install/i.test(error.message);
}

export function formatClose(details: BrowserClosedDetails): string {
  return details.existed
    ? `Closed browser session ${details.session}.`
    : `Browser session ${details.session} was not open.`;
}

export function formatInteraction(details: BrowserInteractedDetails): string {
  const target = details.elementId ? `element ${details.elementId}` : details.selector ? `selector ${details.selector}` : "page keyboard";
  return `Ran ${details.action} on ${target}. Inspect again before using element IDs.`;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return value;
  return buffer.subarray(0, maxBytes).toString("utf8");
}

export async function formatRawHtmlResult(
  captured: { session: string; url: string; title: string; selector?: string; html: string },
  artifactDir: string,
): Promise<AgentToolResult<BrowserRawHtmlDetails>> {
  const bytes = byteLength(captured.html);
  const truncated = bytes > RAW_HTML_RESPONSE_LIMIT_BYTES;
  const details: BrowserRawHtmlDetails = {
    status: "captured",
    session: captured.session,
    url: captured.url,
    title: captured.title,
    ...(captured.selector !== undefined ? { selector: captured.selector } : {}),
    bytes,
    truncated,
  };

  if (!truncated) return textResult(captured.html, details);

  await mkdir(artifactDir, { recursive: true });
  const artifactFile = rawHtmlArtifactFile(captured.session);
  const artifactPath = join(artifactDir, artifactFile);
  await writeFile(artifactPath, captured.html, "utf8");

  return textResult(
    `${truncateUtf8(captured.html, RAW_HTML_RESPONSE_LIMIT_BYTES)}\n\n[Raw HTML truncated from ${bytes} bytes. Full HTML saved to ${artifactPath}.]`,
    { ...details, artifactPath, artifactFile },
  );
}
