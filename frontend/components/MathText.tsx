"use client";

import katex from "katex";

type MathPart = {
  type: "text" | "math";
  value: string;
  display?: boolean;
};

function splitMath(text: string): MathPart[] {
  const parts: MathPart[] = [];
  let i = 0;
  let buffer = "";

  const flush = () => {
    if (buffer) {
      parts.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (i < text.length) {
    if (text.startsWith("$$", i)) {
      const end = text.indexOf("$$", i + 2);
      if (end !== -1) {
        flush();
        parts.push({ type: "math", value: text.slice(i + 2, end), display: true });
        i = end + 2;
        continue;
      }
    }
    if (text.startsWith("\\[", i)) {
      const end = text.indexOf("\\]", i + 2);
      if (end !== -1) {
        flush();
        parts.push({ type: "math", value: text.slice(i + 2, end), display: true });
        i = end + 2;
        continue;
      }
    }
    if (text.startsWith("\\(", i)) {
      const end = text.indexOf("\\)", i + 2);
      if (end !== -1) {
        flush();
        parts.push({ type: "math", value: text.slice(i + 2, end), display: false });
        i = end + 2;
        continue;
      }
    }
    if (text[i] === "$" && text[i + 1] !== "$") {
      let end = i + 1;
      let closed = false;
      while (end < text.length) {
        if (text[end] === "\n") break;
        if (text[end] === "\\") {
          end += 2;
          continue;
        }
        if (text[end] === "$") {
          closed = true;
          break;
        }
        end += 1;
      }
      if (closed) {
        flush();
        parts.push({ type: "math", value: text.slice(i + 1, end), display: false });
        i = end + 1;
        continue;
      }
    }
    buffer += text[i];
    i += 1;
  }
  flush();
  return parts;
}

function renderLatex(source: string, displayMode: boolean): string {
  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      output: "html",
    });
  } catch {
    return source;
  }
}

export function MathText({
  text,
  className,
}: {
  text?: string | null;
  className?: string;
}) {
  if (!text) return null;
  const parts = splitMath(text);
  if (parts.length === 1 && parts[0].type === "text") {
    return <span className={className}>{text}</span>;
  }
  return (
    <span className={className ? `math-text ${className}` : "math-text"}>
      {parts.map((part, index) =>
        part.type === "text" ? (
          <span key={index}>{part.value}</span>
        ) : (
          <span
            key={index}
            className={part.display ? "math-display" : "math-inline"}
            dangerouslySetInnerHTML={{
              __html: renderLatex(part.value.trim(), Boolean(part.display)),
            }}
          />
        )
      )}
    </span>
  );
}
