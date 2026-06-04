export type SearchHighlightSegment = {
  isMatch: boolean;
  text: string;
};

export function normalizeSearchHighlightTerm(search: string) {
  return search.trim().toLowerCase();
}

export function textMatchesSearch(value: string | null | undefined, search: string) {
  if (!search) {
    return false;
  }

  return (value ?? "").toLowerCase().includes(search);
}

export function getSearchHighlightSegments(
  text: string,
  search: string,
): SearchHighlightSegment[] {
  const normalizedSearch = normalizeSearchHighlightTerm(search);

  if (!normalizedSearch) {
    return [{ isMatch: false, text }];
  }

  const lowerText = text.toLowerCase();
  const firstMatchIndex = lowerText.indexOf(normalizedSearch);

  if (firstMatchIndex === -1) {
    return [{ isMatch: false, text }];
  }

  const segments: SearchHighlightSegment[] = [];
  let cursor = 0;
  let matchIndex = firstMatchIndex;

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      segments.push({
        isMatch: false,
        text: text.slice(cursor, matchIndex),
      });
    }

    const matchEnd = matchIndex + normalizedSearch.length;

    segments.push({
      isMatch: true,
      text: text.slice(matchIndex, matchEnd),
    });
    cursor = matchEnd;
    matchIndex = lowerText.indexOf(normalizedSearch, cursor);
  }

  if (cursor < text.length) {
    segments.push({ isMatch: false, text: text.slice(cursor) });
  }

  return segments;
}
