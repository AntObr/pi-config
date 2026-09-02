export const BROWSER_INTERACTION_ACTIONS = ["click", "fill", "type", "press", "select"] as const;
export type BrowserInteractionAction = (typeof BROWSER_INTERACTION_ACTIONS)[number];
