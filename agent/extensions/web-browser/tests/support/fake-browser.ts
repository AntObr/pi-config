type FakePage = {
  goto(url: string): Promise<void>;
  url(): string;
  title(): Promise<string>;
  evaluate(): Promise<{ text: string; elements: [{ tag: "a"; text: string; selectors: string[] }] }>;
  locator(selector: string): { click(): Promise<void> };
};

export function makeProcessFakeBrowser() {
  const closedBrowsers: number[] = [];
  const closedContexts: number[] = [];
  let nextId = 1;

  const browserType = {
    async launch() {
      const id = nextId++;
      let currentUrl = "";
      const page: FakePage = {
        async goto(url: string) {
          currentUrl = url;
        },
        url() {
          return currentUrl;
        },
        async title() {
          return `Title for ${currentUrl}`;
        },
        async evaluate() {
          const name = currentUrl.split("/").filter(Boolean).at(-1) ?? "default";
          return {
            text: `Text for ${currentUrl}`,
            elements: [{ tag: "a", text: `Link for ${name}`, selectors: [`#${name}`] }],
          };
        },
        locator() {
          return { async click() {} };
        },
      };
      return {
        async newContext() {
          return {
            async newPage() {
              return page;
            },
            async close() {
              closedContexts.push(id);
            },
          };
        },
        async close() {
          closedBrowsers.push(id);
        },
      };
    },
  };

  return { browserType, closedBrowsers, closedContexts };
}
