import { lazy, Suspense } from "react";
import type { Paste } from "./api";
import { cn } from "./lib";

const CodeContent = lazy(() => import("./CodeContent"));
const MarkdownContent = lazy(() => import("./MarkdownContent"));

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
  return (
    <Suspense fallback={<RendererLoading light={light} />}>
      {format === "markdown" ? (
        <MarkdownContent content={content} light={light} />
      ) : (
        <CodeContent content={content} language={language} light={light} />
      )}
    </Suspense>
  );
}

function RendererLoading({ light }: { light: boolean }) {
  return (
    <div className={cn("markdown-body p-5", light ? "bg-white text-zinc-900" : "bg-zinc-950 text-zinc-100")}>
      正在加载渲染器...
    </div>
  );
}
