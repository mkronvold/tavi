import { Children, Fragment, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  formatMarkdownLinkChildren,
  isExternalMarkdownHref,
} from "./notes-markdown-helpers";
import { getSearchHighlightSegments } from "./search-highlight";

export function NotesMarkdown({
  className,
  emptyLabel,
  highlight,
  value,
}: {
  className?: string;
  emptyLabel: string;
  highlight?: string;
  value: string | null | undefined;
}) {
  const normalizedValue = normalizeMarkdownDisplayValue(value);

  if (!normalizedValue) {
    return <div className={className}>{emptyLabel}</div>;
  }

  return (
    <div className={className}>
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            const externalHref = isExternalMarkdownHref(href);
            const displayChildren =
              externalHref && typeof href === "string"
                ? formatMarkdownLinkChildren(href, children)
                : children;

            return (
              <a
                href={href}
                rel={externalHref ? "noopener noreferrer" : undefined}
                target={externalHref ? "_blank" : undefined}
                title={externalHref ? href : undefined}
              >
                {highlightMarkdownChildren(displayChildren, highlight)}
              </a>
            );
          },
          blockquote: ({ children }) => (
            <blockquote>
              {highlightMarkdownChildren(children, highlight)}
            </blockquote>
          ),
          code: ({ children }) => (
            <code>{highlightMarkdownChildren(children, highlight)}</code>
          ),
          del: ({ children }) => (
            <del>{highlightMarkdownChildren(children, highlight)}</del>
          ),
          em: ({ children }) => (
            <em>{highlightMarkdownChildren(children, highlight)}</em>
          ),
          h1: ({ children }) => (
            <h1>{highlightMarkdownChildren(children, highlight)}</h1>
          ),
          h2: ({ children }) => (
            <h2>{highlightMarkdownChildren(children, highlight)}</h2>
          ),
          h3: ({ children }) => (
            <h3>{highlightMarkdownChildren(children, highlight)}</h3>
          ),
          h4: ({ children }) => (
            <h4>{highlightMarkdownChildren(children, highlight)}</h4>
          ),
          h5: ({ children }) => (
            <h5>{highlightMarkdownChildren(children, highlight)}</h5>
          ),
          h6: ({ children }) => (
            <h6>{highlightMarkdownChildren(children, highlight)}</h6>
          ),
          li: ({ children }) => (
            <li>{highlightMarkdownChildren(children, highlight)}</li>
          ),
          p: ({ children }) => (
            <p>{highlightMarkdownChildren(children, highlight)}</p>
          ),
          strong: ({ children }) => (
            <strong>{highlightMarkdownChildren(children, highlight)}</strong>
          ),
        }}
        remarkPlugins={[remarkGfm, remarkBreaks]}
      >
        {normalizedValue}
      </ReactMarkdown>
    </div>
  );
}

function normalizeMarkdownDisplayValue(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  return trimmedValue ? trimmedValue.replace(/\r\n?/gu, "\n") : null;
}

function highlightMarkdownChildren(
  children: ReactNode,
  highlight: string | undefined,
) {
  return Children.map(children, (child) =>
    typeof child === "string"
      ? getSearchHighlightSegments(child, highlight ?? "").map(
          (segment, index) =>
            segment.isMatch ? (
              <mark className="search-highlight" key={index}>
                {segment.text}
              </mark>
            ) : (
              <Fragment key={index}>{segment.text}</Fragment>
            ),
        )
      : child,
  );
}
