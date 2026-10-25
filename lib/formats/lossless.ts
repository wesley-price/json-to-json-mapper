// JSON numbers beyond 2^53 (9,007,199,254,740,991) can't be held exactly by
// JavaScript: JSON.parse rounds them (long IDs, Kafka offsets, snowflake IDs).
// This parser keeps such integers as text instead, with every digit, and
// reports which ones it kept.

import type { Json } from "../json-tree";

export function parseJsonLossless(text: string): { value: Json; big: string[] } {
  const big: string[] = [];
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      // Copy a string untouched (escapes included).
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
      if (m) {
        const token = m[0];
        if (!m[1] && !m[2] && !Number.isSafeInteger(Number(token))) {
          big.push(token);
          out += `"${token}"`;
        } else out += token;
        i += token.length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return { value: JSON.parse(out) as Json, big };
}

/** The note shown for numbers kept as text. */
export const bigNumberNote = (n: string) =>
  `${n} is larger than JavaScript can hold exactly (above 9,007,199,254,740,991), so it is kept as text with every digit.`;
