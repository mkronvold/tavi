import { isValidElement, type ReactNode } from "react";

const MAX_DISPLAY_LINK_LABEL_LENGTH = 35;

function isExternalHref(value: string | undefined) {
  return typeof value === "string" && /^https?:\/\//iu.test(value);
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

export function formatMarkdownLinkChildren(href: string, children: ReactNode) {
  const childText = flattenTextContent(children);

  if (childText !== href) {
    return children;
  }

  return truncateDisplayLinkLabel(extractUrlFilename(href) ?? childText);
}

export function isExternalMarkdownHref(value: string | undefined) {
  return isExternalHref(value);
}

export function truncateDisplayLinkLabel(value: string) {
  if (value.length <= MAX_DISPLAY_LINK_LABEL_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_DISPLAY_LINK_LABEL_LENGTH - 3)}...`;
}

function decodeUrlPathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
