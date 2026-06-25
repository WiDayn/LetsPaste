import hljs from "highlight.js/lib/common";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { Paste } from "./api";
import { cn } from "./lib";

export default function PasteContent({
  content,
  language,
  format,
  light = false,
}: {
  content: string;
  language: string;
  format: Paste["format"];
  light?: boolean;
}) {
  const html = useMemo(() => {
    if (!content) return "";
    try {
      if (language && language !== "plaintext" && hljs.getLanguage(language)) {
        return hljs.highlight(content, { language }).value;
      }
      return hljs.highlightAuto(content).value;
    } catch {
      return escapeHTML(content);
    }
  }, [content, language]);

  if (format === "markdown") {
    return (
      <div className={cn("markdown-body p-5", light ? "bg-white text-zinc-900" : "bg-zinc-950 text-zinc-100")}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <pre className={cn("m-0 min-h-full overflow-auto p-5 text-sm leading-6", light ? "bg-white text-zinc-900" : "bg-zinc-950 text-zinc-100")}>
      <code dangerouslySetInnerHTML={{ __html: html || escapeHTML(content) }} />
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
