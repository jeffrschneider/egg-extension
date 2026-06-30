/**
 * Extension content-script entry for article extraction. Bundled by esbuild
 * into readability.js (see extension build script) so it can pull in the
 * shared readArticle() — the SAME Mozilla Readability pass the browser's
 * Reader/capture path uses. Replaces the old homegrown DOM heuristic so the
 * extraction logic lives in exactly one place.
 *
 * It still publishes window.__eggReadable.extract() with the {text, html,
 * kind} shape content-script.js already expects.
 */
import { readArticle } from "../../../src/content/extract/article-core";

interface ReadableResult {
  kind: "article" | "fallback";
  text: string;
  html: string | null;
  title?: string;
  byline?: string | null;
}

declare global {
  interface Window {
    __eggReadable: { extract(): ReadableResult };
  }
}

window.__eggReadable = {
  extract(): ReadableResult {
    const article = readArticle(document, location.href);
    if (article && article.text.trim().length > 0) {
      return {
        kind: "article",
        text: article.text.slice(0, 50000),
        html: article.html.slice(0, 200000),
        title: article.title,
        byline: article.byline,
      };
    }
    // No article-like content — hand back the raw body text.
    return {
      kind: "fallback",
      text: document.body?.innerText?.slice(0, 50000) || "",
      html: null,
    };
  },
};
