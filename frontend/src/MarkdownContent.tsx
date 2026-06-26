import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { useEffect, useState } from "react";
import remarkGfm from "remark-gfm";
import type { Pluggable, PluggableList } from "unified";
import { cn } from "./lib";
import { syntaxHighlightMaxCharacters } from "./rendering";

const remarkPlugins = [remarkGfm];
const noRehypePlugins: PluggableList = [];
let rehypeHighlightPlugin: Pluggable | null = null;
let rehypeHighlightPromise: Promise<Pluggable> | null = null;
const markdownComponents: Components = {
  table({ node: _node, ...props }) {
    return (
      <div className="markdown-table-scroll" role="region" aria-label="Markdown 表格" tabIndex={0}>
        <table {...props} />
      </div>
    );
  },
};

function loadRehypeHighlight() {
  rehypeHighlightPromise ??= import("rehype-highlight").then((module) => {
    rehypeHighlightPlugin = module.default;
    return module.default;
  });
  return rehypeHighlightPromise;
}

export default function MarkdownContent({ content, light = false }: { content: string; light?: boolean }) {
  const shouldHighlight = content.length <= syntaxHighlightMaxCharacters;
  const [highlightPlugin, setHighlightPlugin] = useState<Pluggable | null>(() => (shouldHighlight ? rehypeHighlightPlugin : null));
  const activeRehypePlugins: PluggableList = shouldHighlight && highlightPlugin ? [highlightPlugin] : noRehypePlugins;

  useEffect(() => {
    let cancelled = false;
    if (!shouldHighlight) {
      setHighlightPlugin(null);
      return undefined;
    }
    if (rehypeHighlightPlugin) {
      setHighlightPlugin(() => rehypeHighlightPlugin);
      return undefined;
    }
    loadRehypeHighlight()
      .then((plugin) => {
        if (!cancelled) setHighlightPlugin(() => plugin);
      })
      .catch(() => {
        if (!cancelled) setHighlightPlugin(null);
      });
    return () => {
      cancelled = true;
    };
  }, [shouldHighlight]);

  return (
    <div className={cn("content-surface markdown-body p-5", light ? "content-surface-light bg-white text-zinc-900" : "content-surface-dark bg-zinc-950 text-zinc-100")}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={activeRehypePlugins} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
