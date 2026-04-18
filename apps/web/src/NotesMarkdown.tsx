import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  formatMarkdownLinkChildren,
  isExternalMarkdownHref,
} from "./notes-markdown-helpers";

export function NotesMarkdown({
  className,
  emptyLabel,
  value,
}: {
  className?: string;
  emptyLabel: string;
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
                {displayChildren}
              </a>
            );
          },
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
