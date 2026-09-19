import { Fragment } from "react";

const linkPattern = /(https?:\/\/[^\s<>"']+)/gu;
const trailingPunctuation = /[.,;:!?)\]]+$/u;

/**
 * Plain text as it was typed, line breaks kept, with each web address a
 * link that opens in a new tab. Punctuation that closes a sentence after
 * an address stays text.
 */
export function LinkedText({
  className,
  text,
}: {
  readonly className?: string | undefined;
  readonly text: string;
}) {
  const parts = text.split(linkPattern);
  return (
    <p className={className}>
      {parts.map((part, index) => {
        const key = `${index}-${part.slice(0, 16)}`;
        if (index % 2 === 0) return <Fragment key={key}>{part}</Fragment>;
        const trailing = trailingPunctuation.exec(part)?.[0] ?? "";
        const href = part.slice(0, part.length - trailing.length);
        return (
          <Fragment key={key}>
            <a
              className="note-link"
              href={href}
              rel="noopener noreferrer"
              target="_blank"
            >
              {href}
            </a>
            {trailing}
          </Fragment>
        );
      })}
    </p>
  );
}
