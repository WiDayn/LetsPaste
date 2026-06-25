import hljs from "highlight.js/lib/common";
import { useMemo } from "react";
import { cn } from "./lib";

export default function CodeContent({
  content,
  language,
  light = false,
  wrapLines = false,
}: {
  content: string;
  language: string;
  light?: boolean;
  wrapLines?: boolean;
}) {
  const html = useMemo(() => {
    if (!content) return "";
    try {
      if (language && language !== "plaintext" && hljs.getLanguage(language)) {
        return hljs.highlight(content, { language }).value;
      }
      return escapeHTML(content);
    } catch {
      return escapeHTML(content);
    }
  }, [content, language]);

  return (
    <pre
      className={cn(
        "content-surface syntax-viewer m-0 min-h-full overflow-auto p-5 text-sm leading-6",
        light ? "content-surface-light bg-white text-zinc-900" : "content-surface-dark bg-zinc-950 text-zinc-100",
        wrapLines && "content-wrap",
      )}
    >
      <code className="hljs" dangerouslySetInnerHTML={{ __html: html || escapeHTML(content) }} />
    </pre>
  );
}

function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}
