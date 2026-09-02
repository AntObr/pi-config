import type { Page } from "playwright";
import type { BrowserSession, WebBrowserConfig } from "./types.js";

export type InspectedElement = {
  id: string;
  tag: string;
  role?: string;
  text?: string;
  name?: string;
  type?: string;
  href?: string;
  selector: string;
};

function compact(value: string | undefined | null, max = 180): string | undefined {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function formatInspection(data: {
  url: string;
  title: string;
  text: string;
  elements: InspectedElement[];
  inspectionVersion: number;
}): string {
  const lines = [`URL: ${data.url}`, `Title: ${data.title || "(none)"}`, `Inspection: ${data.inspectionVersion}`];
  lines.push("", "Visible text:", data.text || "(none)", "", "Interactable elements:");
  if (data.elements.length === 0) {
    lines.push("(none)");
  } else {
    for (const element of data.elements) {
      const parts = [`[${element.id}]`, element.tag];
      if (element.role) parts.push(`role=${element.role}`);
      if (element.type) parts.push(`type=${element.type}`);
      if (element.name) parts.push(`name=${JSON.stringify(element.name)}`);
      if (element.text) parts.push(`text=${JSON.stringify(element.text)}`);
      if (element.href) parts.push(`href=${JSON.stringify(element.href)}`);
      parts.push(`selector=${JSON.stringify(element.selector)}`);
      lines.push(parts.join(" "));
    }
  }
  lines.push("", "Element IDs are valid only for this inspection. Inspect again after navigation or DOM changes.");
  return lines.join("\n");
}

export async function inspectPage(page: Page, session: BrowserSession, config: WebBrowserConfig): Promise<{
  text: string;
  elements: InspectedElement[];
  title: string;
  url: string;
}> {
  session.elementMap.clear();
  session.inspectionVersion += 1;
  const title = await page.title().catch(() => "");
  const url = page.url();
  const visibleText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  const text = compact(visibleText, config.inspectionTextMaxChars) ?? "";
  const rawElements = await page.locator("a,button,input,select,textarea,[role=button],[role=link]").evaluateAll((nodes) => {
    function ownSelector(el: Element): string {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const attr = ["data-testid", "data-test", "aria-label", "name", "placeholder"].find((name) => el.getAttribute(name));
      if (attr) return `${el.tagName.toLowerCase()}[${attr}=${JSON.stringify(el.getAttribute(attr))}]`;
      const parent = el.parentElement;
      const tag = el.tagName.toLowerCase();
      if (!parent) return tag;
      const sameTag = [...parent.children].filter((child) => child.tagName === el.tagName);
      const index = sameTag.indexOf(el) + 1;
      return sameTag.length > 1 ? `${tag}:nth-of-type(${index})` : tag;
    }
    function fullSelector(el: Element): string {
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur !== document.body && parts.length < 5) {
        const part = ownSelector(cur);
        parts.unshift(part);
        if (part.startsWith("#")) break;
        cur = cur.parentElement;
      }
      return parts.join(" > ");
    }
    return nodes
      .filter((node) => {
        const el = node as HTMLElement;
        const style = getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none" && !el.hasAttribute("disabled");
      })
      .slice(0, 80)
      .map((node) => {
        const el = node as HTMLInputElement | HTMLAnchorElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement;
        return {
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") || undefined,
          text: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("value") || "").replace(/\s+/g, " ").trim(),
          name: el.getAttribute("name") || el.getAttribute("aria-label") || el.getAttribute("placeholder") || undefined,
          type: el.getAttribute("type") || undefined,
          href: el instanceof HTMLAnchorElement ? el.href : undefined,
          selector: fullSelector(el),
        };
      });
  });
  const elements = rawElements.map((element, index) => {
    const id = `e${index + 1}`;
    session.elementMap.set(id, element.selector);
    return { id, ...element, text: compact(element.text), name: compact(element.name), href: compact(element.href, 300) };
  });
  return { text, elements, title, url };
}
