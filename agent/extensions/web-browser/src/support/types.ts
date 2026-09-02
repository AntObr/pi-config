export type NavigationDeniedDetails = {
  status: "denied";
  reason: string;
};

export type NavigationLoadedDetails = {
  status: "loaded";
  session: string;
  url: string;
  title: string;
  timeoutMs: number;
  dynamicViewport: boolean;
};

export type BrowserClosedDetails = {
  status: "closed";
  session: string;
  existed: boolean;
};

export type BrowserSessionModeConflictDetails = {
  status: "session_mode_conflict";
  reason: string;
};

export type BrowserInstallRequiredDetails = {
  status: "browser_install_required";
  reason: string;
};

export type BrowserInspectionUnavailableDetails = {
  status: "inspection_unavailable";
  reason: string;
};

export type BrowserInteractionUnavailableDetails = {
  status: "interaction_unavailable";
  reason: string;
};

export type BrowserRawHtmlUnavailableDetails = {
  status: "raw_html_unavailable";
  reason: string;
};

export type BrowserScreenshotUnavailableDetails = {
  status: "screenshot_unavailable";
  reason: string;
};

export type BrowserRawHtmlDetails = {
  status: "captured";
  session: string;
  url: string;
  title: string;
  selector?: string;
  bytes: number;
  truncated: boolean;
  artifactPath?: string;
  artifactFile?: string;
};

export type BrowserScreenshotDetails = {
  status: "captured";
  session: string;
  url: string;
  title: string;
  artifactPath: string;
  artifactFile: string;
  fullPage: boolean;
};

export type BrowserInteractedDetails = {
  status: "interacted";
  session: string;
  action: InteractionAction;
  selector?: string;
  elementId?: string;
  value?: string;
};

export type InteractionAction = "click" | "type" | "fill" | "press" | "select";
export type InteractionRequest = { action: InteractionAction; elementId?: string; selector?: string; value?: string };

export type InspectElementDetails = {
  id: string;
  tag: string;
  type?: string;
  text?: string;
  label?: string;
  href?: string;
  selectors: string[];
};

export type InspectionDetails = {
  status: "inspected";
  session: string;
  inspectionId: number;
  elementIdScope: string;
  url: string;
  title: string;
  text: string;
  elements: InspectElementDetails[];
};

export type ConfigErrorDetails = {
  status: "config_error";
  reason: string;
};
