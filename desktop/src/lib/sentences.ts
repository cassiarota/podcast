/**
 * Split a page of text into sentences. Used by the streaming-TTS player
 * to fire one sidecar call per sentence (so the first sentence is heard
 * within ~1-2 s instead of waiting for the whole page).
 *
 * Splitting strategy: CJK + ASCII sentence terminators (。！？；.!?;),
 * with paragraph breaks (\n\n) also forcing a boundary. Closing quotes
 * stay with the sentence they end.
 */
const TERMINATORS = new Set([
  "。", "！", "？", "；",
  ".", "!", "?", ";",
]);
const CLOSING_QUOTES = new Set([
  '"', "”", "」", "』", "”",
]);

export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    buf += c;
    if (TERMINATORS.has(c)) {
      const next = text[i + 1];
      if (next && CLOSING_QUOTES.has(next)) {
        buf += next;
        i++;
      }
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = "";
    } else if (c === "\n" && text[i + 1] === "\n") {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = "";
      i++;
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out.filter((s) => s.length > 0);
}
