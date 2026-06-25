import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { cn } from "./lib";

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

export default function MarkdownContent({ content, light = false }: { content: string; light?: boolean }) {
  return (
    <div className={cn("markdown-body p-5", light ? "bg-white text-zinc-900" : "bg-zinc-950 text-zinc-100")}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
