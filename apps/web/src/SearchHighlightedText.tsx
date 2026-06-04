import { Fragment } from "react";
import { getSearchHighlightSegments } from "./search-highlight";

export function SearchHighlightedText({
  search,
  text,
}: {
  search: string;
  text: string;
}) {
  return (
    <>
      {getSearchHighlightSegments(text, search).map((segment, index) =>
        segment.isMatch ? (
          <mark className="search-highlight" key={index}>
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
