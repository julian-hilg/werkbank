import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];

/**
 * Renders markdown (with tables, task lists and strikethrough) as React
 * elements. Raw HTML in the source is shown as text, never executed, so it
 * is safe for content written by an agent or loaded from elsewhere.
 */
export default function MarkdownImpl({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`wb-markdown ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={plugins}
        components={{
          // Links leave the app, so they open in a new tab and cannot reach back into this one.
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
