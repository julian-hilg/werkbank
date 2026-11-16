import { Suspense, lazy } from "react";

// The renderer is a sizeable library, so it loads the first time markdown is shown.
const Impl = lazy(() => import("./MarkdownImpl"));

/**
 * Renders markdown (with tables, task lists and strikethrough) as React
 * elements. Raw HTML in the source is shown as text, never executed, so it
 * is safe for content written by an agent or loaded from elsewhere.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    // Until the renderer has loaded, the source is shown as plain text.
    <Suspense fallback={<div className={`wb-markdown ${className ?? ""}`} style={{ whiteSpace: "pre-wrap" }}>{text}</div>}>
      <Impl text={text} className={className} />
    </Suspense>
  );
}
