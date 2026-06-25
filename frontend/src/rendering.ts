export const syntaxHighlightMaxCharacters = 200_000;

type ContentFormat = "code" | "markdown";

let codeRendererPreload: Promise<unknown> | null = null;
let markdownRendererPreload: Promise<unknown> | null = null;

export function preloadPasteContentRenderer(format: ContentFormat) {
  if (format === "markdown") {
    markdownRendererPreload ??= import("./MarkdownContent");
    return;
  }
  codeRendererPreload ??= import("./CodeContent");
}
