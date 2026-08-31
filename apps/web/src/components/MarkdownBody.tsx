import { resolveMarkdownAsset, resolveMarkdownLink } from "@castle/content";
import { slug } from "github-slugger";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import type { CastleNote } from "../lib/snapshot";
import { withBase } from "../lib/snapshot";

interface MarkdownBodyProps {
  base: string;
  content: string;
  document: CastleNote;
  notes: CastleNote[];
}

export function MarkdownBody({ base, content, document, notes }: MarkdownBodyProps) {
  const notesBySource = new Map(notes.map((note) => [note.sourceFile, note]));
  const components: Components = {
    h1: createHeading("h1"),
    h2: createHeading("h2"),
    h3: createHeading("h3"),
    h4: createHeading("h4"),
    a: ({ node: _node, href = "", children, ...props }) => {
      const resolved = resolveMarkdownLink(document, href, notesBySource);
      const external = /^[a-z]+:/i.test(resolved);
      return (
        <a
          {...props}
          href={external ? resolved : withBase(resolved, base)}
          rel={external ? "noreferrer" : undefined}
        >
          {children}
        </a>
      );
    },
    img: ({ node: _node, src = "", alt = "", ...props }) => (
      <img
        {...props}
        src={withBase(resolveMarkdownAsset(document, src), base)}
        alt={alt}
        loading="lazy"
      />
    ),
    input: ({ node: _node, ...props }) => (
      <input {...props} disabled={props.type === "checkbox"} />
    ),
    table: ({ children }) => (
      <div className="table-scroll">
        <table>{children}</table>
      </div>
    ),
  };

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
      {content}
    </ReactMarkdown>
  );
}

function createHeading(Tag: "h1" | "h2" | "h3" | "h4") {
  return function Heading({
    children,
    node: _node,
    ...props
  }: ComponentPropsWithoutRef<typeof Tag> & { node?: unknown }) {
    return <Tag {...props} id={slug(textFromChildren(children))}>{children}</Tag>;
  };
}

function textFromChildren(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textFromChildren).join("");
  if (children && typeof children === "object" && "props" in children) {
    const props = children.props as { children?: ReactNode };
    return textFromChildren(props.children);
  }
  return "";
}
