import { isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

const MAX_DISPLAY_LINK_LABEL_LENGTH = 35;

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
            const externalHref = isExternalHref(href);
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

function isExternalHref(value: string | undefined) {
  return typeof value === "string" && /^https?:\/\//iu.test(value);
}

function formatMarkdownLinkChildren(href: string, children: ReactNode) {
  const childText = flattenTextContent(children);

  if (childText !== href) {
    return children;
  }

  return truncateDisplayLinkLabel(extractUrlFilename(href) ?? childText);
}

function flattenTextContent(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => flattenTextContent(item)).join("");
  }

  if (isValidElement<{ children?: ReactNode }>(value)) {
    return flattenTextContent(value.props.children);
  }

  return "";
}

export function extractUrlFilename(value: string) {
  if (!isExternalHref(value)) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const normalizedPath = parsed.pathname.replace(/\/+$/u, "");
    const segments = normalizedPath
      .split("/")
      .filter((segment) => segment.length > 0);
    const lastSegment = segments.at(-1);

    if (!lastSegment) {
      return null;
    }

    const decodedSegment = decodeUrlPathSegment(lastSegment);

    return /^[^./][^/]*\.[^./]+$/u.test(decodedSegment) ? decodedSegment : null;
  } catch {
    return null;
  }
}

function decodeUrlPathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function truncateDisplayLinkLabel(value: string) {
  if (value.length <= MAX_DISPLAY_LINK_LABEL_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_DISPLAY_LINK_LABEL_LENGTH - 3)}...`;
}
