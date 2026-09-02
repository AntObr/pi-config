import type { InspectElementDetails } from "../support/types.ts";

export type BrowserTypeLike = {
  launch(options: { headless: boolean }): Promise<BrowserLike>;
};

export type BrowserLike = {
  newContext(options?: BrowserContextOptionsLike): Promise<BrowserContextLike>;
  close(): Promise<void>;
};

export type BrowserContextOptionsLike = {
  viewport?: null;
};

export type BrowserContextLike = {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
};

export type LocatorLike = {
  click(): Promise<unknown>;
  type(value: string): Promise<unknown>;
  fill(value: string): Promise<unknown>;
  press(value: string): Promise<unknown>;
  selectOption(value: string): Promise<unknown>;
};

export type PageLike = {
  goto(url: string, options: { waitUntil: "load"; timeout: number }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  evaluate<R, Arg = undefined>(pageFunction: (arg: Arg) => R, arg?: Arg): Promise<R>;
  locator(selector: string): LocatorLike;
  screenshot(options: { path: string; fullPage: boolean }): Promise<Buffer>;
  keyboard?: { press(value: string): Promise<unknown> };
};

export type BrowserSession = {
  browser: BrowserLike;
  context: BrowserContextLike;
  page: PageLike;
  inspectionSequence: number;
  latestInspection?: {
    elements: InspectElementDetails[];
  };
  headless: boolean;
  dynamicViewport: boolean;
};
