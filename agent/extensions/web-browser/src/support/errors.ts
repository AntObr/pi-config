export class BrowserConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserConfigError";
  }
}

export class NavigationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NavigationPolicyError";
  }
}

export class BrowserSessionModeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserSessionModeConflictError";
  }
}

export class BrowserInspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserInspectionError";
  }
}

export class BrowserInteractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserInteractionError";
  }
}

export class BrowserRawHtmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserRawHtmlError";
  }
}

export class BrowserScreenshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserScreenshotError";
  }
}
