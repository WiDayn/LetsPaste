import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { cn } from "./lib";

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];
const markdownComponents: Components = {
  table({ node: _node, ...props }) {
    return (
      <div className="markdown-table-scroll" role="region" aria-label="Markdown 表格" tabIndex={0}>
        <table {...props} />
      </div>
    );
  },
};

export default function MarkdownContent({ content, light = false }: { content: string; light?: boolean }) {
  return (
    <div className={cn("content-surface markdown-body p-5", light ? "content-surface-light bg-white text-zinc-900" : "content-surface-dark bg-zinc-950 text-zinc-100")}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
