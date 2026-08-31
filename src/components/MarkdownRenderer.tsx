import {
  Icon,
  Popover,
  PopoverInteractionKind,
} from "@patkepa/kantzen-ui/primitives";
import {
  resolveMarkdownAsset,
  resolveMarkdownLink,
} from "@castle/content";
import { useMemo, type ComponentProps, type ReactNode } from "react";
import { slug } from "github-slugger";
import ReactMarkdown, { type Components } from "react-markdown";
import { Link } from "react-router-dom";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import type { Heading, Note } from "../types";

interface MarkdownRendererProps {
  content: string;
  document: Note;
  notes?: readonly Note[];
  headings?: readonly Heading[];
}

interface PositionedMarkdownNode {
  position?: {
    start: {
      column: number;
      line: number;
    };
  };
}

const emptyNotes: readonly Note[] = [];
const emptyHeadings: readonly Heading[] = [];
const markdownPlugins = [remarkGfm, remarkBreaks];

export const NOTE_LINK_PREVIEW_HOVER_DELAY_MS = 500;

export function MarkdownRenderer({
  content,
  document,
  notes = emptyNotes,
  headings = emptyHeadings,
}: MarkdownRendererProps) {
  const components = useMemo(
    () => createMarkdownComponents(document, notes, headings),
    [document, headings, notes],
  );

  return (
    <ReactMarkdown remarkPlugins={markdownPlugins} components={components}>
      {content}
    </ReactMarkdown>
  );
}

function createMarkdownComponents(
  document: Note,
  notes: readonly Note[],
  headings: readonly Heading[],
): Components {
  const sourceLookup = new Map(
    notes.map((candidate) => [candidate.sourceFile, candidate]),
  );
  const routeLookup = new Map(
    notes.map((candidate) => [candidate.route, candidate]),
  );
  const headingIdsByLine = new Map(
    headings.map((heading) => [heading.line, heading.id]),
  );

  const heading =
    (depth: 2 | 3 | 4) =>
    ({
      children,
      node,
    }: {
      children?: ReactNode;
      node?: { position?: { start: { line: number } } };
    }) => {
      const label = textFromChildren(children);
      const id =
        headingIdsByLine.get(node?.position?.start.line ?? -1) ?? slug(label);
      const HeadingTag = `h${depth}` as const;
      return <HeadingTag id={id}>{children}</HeadingTag>;
    };

  return {
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    a: ({ href = "", children, className, node, ...props }) => {
      const resolved = resolveMarkdownLink(document, href, sourceLookup);
      if (resolved.startsWith("/")) {
        const occurrenceId = resolved.startsWith("/note/")
          ? linkOccurrenceId(node)
          : undefined;
        const targetNote = routeLookup.get(resolved.split("#", 1)[0]);

        if (targetNote) {
          return (
            <NoteLinkWithPreview
              className={className}
              occurrenceId={occurrenceId}
              targetNote={targetNote}
              to={resolved}
              {...props}
            >
              {children}
            </NoteLinkWithPreview>
          );
        }

        return (
          <Link
            className={
              [className, occurrenceId ? "backlink-occurrence" : ""]
                .filter(Boolean)
                .join(" ") || undefined
            }
            id={occurrenceId}
            to={resolved}
            {...props}
          >
            {children}
          </Link>
        );
      }
      return (
        <a
          href={resolved}
          className={className}
          rel={resolved.startsWith("http") ? "noreferrer" : undefined}
          target={resolved.startsWith("http") ? "_blank" : undefined}
          {...props}
        >
          {children}
        </a>
      );
    },
    img: ({ src = "", alt = "", ...props }) => (
      <img
        src={resolveMarkdownAsset(document, src)}
        alt={alt}
        loading="lazy"
        {...props}
      />
    ),
    input: (props) => <input {...props} disabled={props.type === "checkbox"} />,
    table: ({ children }) => (
      <div className="markdown-table-scroll">
        <table>{children}</table>
      </div>
    ),
    pre: ({ children, ...props }) => (
      <div className="code-block">
        <pre {...props}>{children}</pre>
      </div>
    ),
  };
}

interface NoteLinkWithPreviewProps
  extends Omit<ComponentProps<typeof Link>, "to"> {
  occurrenceId?: string;
  targetNote: Note;
  to: string;
}

function NoteLinkWithPreview({
  children,
  className,
  occurrenceId,
  targetNote,
  to,
  ...linkProps
}: NoteLinkWithPreviewProps) {
  const previewId = `note-link-preview-${targetNote.id.replace(/[^a-z0-9_-]/gi, "-")}-${occurrenceId ?? "link"}`;

  return (
    <Popover
      content={<NoteLinkPreview id={previewId} note={targetNote} />}
      hoverCloseDelay={160}
      hoverOpenDelay={NOTE_LINK_PREVIEW_HOVER_DELAY_MS}
      interactionKind={PopoverInteractionKind.HOVER}
      openOnTargetFocus
      placement="top"
      popoverClassName="note-link-preview-popover"
      portalClassName="note-link-preview-portal"
      transitionDuration={120}
      renderTarget={({ setTargetElement, ...targetProps }) => (
        <Link
          {...linkProps}
          {...targetProps}
          aria-describedby={previewId}
          className={
            [
              targetProps.className,
              className,
              occurrenceId ? "backlink-occurrence" : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
          id={occurrenceId}
          ref={setTargetElement}
          to={to}
        >
          {children}
        </Link>
      )}
    />
  );
}

export function NoteLinkPreview({ id, note }: { id: string; note: Note }) {
  const preview = note.preview || note.excerpt;

  return (
    <article className="note-link-preview" id={id} role="tooltip">
      <header>
        <span>{note.sectionLabel}</span>
        {note.readingMinutes > 0 ? (
          <small>{note.readingMinutes} min read</small>
        ) : null}
      </header>
      <h4>{note.title}</h4>
      <p>{preview?.trim() || "No preview available."}</p>
      <footer>
        <Icon icon="document-open" size={11} aria-hidden="true" />
        Open note
      </footer>
    </article>
  );
}

export function linkOccurrenceId(node: PositionedMarkdownNode | undefined) {
  const start = node?.position?.start;
  return start ? `link-occurrence-${start.line}-${start.column}` : undefined;
}

function textFromChildren(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) return children.map(textFromChildren).join("");
  if (
    children &&
    typeof children === "object" &&
    "props" in children &&
    typeof children.props === "object" &&
    children.props &&
    "children" in children.props
  ) {
    return textFromChildren(children.props.children as ReactNode);
  }
  return "";
}
