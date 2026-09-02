import type { InspectElementDetails, InspectionDetails } from "../support/types.ts";

export type InspectedPagePayload = {
  text: string;
  elements: Array<Omit<InspectElementDetails, "id">>;
};

export function inspectPageInBrowser(): InspectedPagePayload {
  const maxTextLength = 8_000;
  const selector = "a[href], button, input, select, textarea";
  // Keep browser-context utilities as object methods so TS loaders that preserve function names
  // do not inject external helpers into serialized code.
  const browserContextHelpers = {
    normalizeText(value: string | null | undefined): string | undefined {
      const text = value?.replace(/\s+/g, " ").trim();
      return text ? text.slice(0, 200) : undefined;
    },

    cssEscape(value: string): string {
      const escape = (globalThis as typeof globalThis & { CSS?: { escape?: (text: string) => string } }).CSS?.escape;
      if (escape) return escape(value);
      return value.replace(/^-?\d|[^a-zA-Z0-9_-]/g, (character) => `\\${character.codePointAt(0)?.toString(16)} `);
    },

    quoted(value: string): string {
      return `"${value.replace(/(["\\])/g, "\\$1")}"`;
    },

    isUsable(element: Element): boolean {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") return false;
      if (element.matches("input[type='hidden'], [hidden], [aria-hidden='true']")) return false;
      return element.getClientRects().length > 0;
    },

    labelFor(element: Element): string | undefined {
      if (!(element instanceof HTMLElement)) return undefined;
      const ariaLabel = browserContextHelpers.normalizeText(element.getAttribute("aria-label"));
      if (ariaLabel) return ariaLabel;
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const labelledText = browserContextHelpers.normalizeText(
          labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.innerText)
            .filter(Boolean)
            .join(" "),
        );
        if (labelledText) return labelledText;
      }
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        if (element.id) {
          const explicitLabel = browserContextHelpers.normalizeText(document.querySelector(`label[for="${browserContextHelpers.cssEscape(element.id)}"]`)?.textContent);
          if (explicitLabel) return explicitLabel;
        }
        const wrappedLabel = browserContextHelpers.normalizeText(element.closest("label")?.textContent);
        if (wrappedLabel) return wrappedLabel;
        const placeholder = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? browserContextHelpers.normalizeText(element.placeholder) : undefined;
        if (placeholder) return placeholder;
        const name = browserContextHelpers.normalizeText(element.getAttribute("name"));
        if (name) return name;
      }
      return undefined;
    },

    selectorsFor(element: Element, text: string | undefined, label: string | undefined): string[] {
      const selectors: string[] = [];
      const tag = element.tagName.toLowerCase();
      const id = element.getAttribute("id");
      if (id) selectors.push(`#${browserContextHelpers.cssEscape(id)}`);
      for (const attr of ["data-testid", "data-test", "data-cy", "name", "placeholder", "aria-label"] as const) {
        const value = element.getAttribute(attr);
        if (value) selectors.push(`${tag}[${attr}=${browserContextHelpers.quoted(value)}]`);
      }
      if (label && element.closest("label")) selectors.push(`label:has-text(${browserContextHelpers.quoted(label)}) ${tag}`);
      if (element instanceof HTMLAnchorElement) {
        const href = element.getAttribute("href");
        if (href) selectors.push(`a[href=${browserContextHelpers.quoted(href)}]`);
      }
      if ((tag === "button" || tag === "a") && text) selectors.push(`${tag}:has-text(${browserContextHelpers.quoted(text)})`);
      if (label && selectors.length === 0) selectors.push(`${tag}:near(:text(${browserContextHelpers.quoted(label)}))`);
      return [...new Set(selectors)].slice(0, 4);
    },
  };

  const text = (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxTextLength);
  const elements = Array.from(document.querySelectorAll(selector))
    .filter(browserContextHelpers.isUsable)
    .map((element) => {
      const tag = element.tagName.toLowerCase();
      const text = browserContextHelpers.normalizeText(element.textContent);
      const label = browserContextHelpers.labelFor(element);
      const type = element instanceof HTMLInputElement ? element.type : undefined;
      const href = element instanceof HTMLAnchorElement ? element.href : undefined;
      return {
        tag,
        ...(type ? { type } : {}),
        ...(text ? { text } : {}),
        ...(label ? { label } : {}),
        ...(href ? { href } : {}),
        selectors: browserContextHelpers.selectorsFor(element, text, label),
      };
    });

  return { text, elements };
}

export const ELEMENT_ID_SCOPE = "latest inspection only; inspect again after navigation or page changes";
export function formatInspection(details: InspectionDetails): string {
  const lines = [`URL: ${details.url}`, `Title: ${details.title || "(untitled)"}`, "", "Visible text:", details.text || "(no visible text)", "", "Interactable elements:"];
  if (details.elements.length === 0) {
    lines.push("(none found)");
  } else {
    for (const element of details.elements) {
      const name = element.text ?? element.label ?? element.href ?? element.tag;
      const parts = [`[${element.id}]`, element.tag];
      if (element.type) parts.push(`type=${element.type}`);
      parts.push(quotedForReport(name));
      if (element.selectors.length > 0) parts.push(`selectors: ${element.selectors.join(", ")}`);
      lines.push(parts.join(" "));
    }
  }
  lines.push("", `Element IDs are scoped to the ${ELEMENT_ID_SCOPE}.`);
  return lines.join("\n");
}

function quotedForReport(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
