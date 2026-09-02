export type RawHtmlPayload = {
  html?: string;
  selectorFound: boolean;
};

export function rawHtmlInBrowser(selector?: string): RawHtmlPayload {
  if (selector !== undefined) {
    const element = document.querySelector(selector);
    if (!element) return { selectorFound: false };
    return { selectorFound: true, html: element.outerHTML };
  }

  const doctype = document.doctype ? new XMLSerializer().serializeToString(document.doctype) + "\n" : "";
  return { selectorFound: true, html: doctype + document.documentElement.outerHTML };
}
