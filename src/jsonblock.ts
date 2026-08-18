// Markdown-wrapped JSON storage: `> label` + a fenced json array. Pure — no Obsidian imports.
// Ledger and aggregates both live in this shape (§V17 vault-native, Dataview-readable).

export function jsonBlock(label: string, data: unknown): string {
  return `> ${label}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
}

/** Rows in the file, or [] when the file is absent/empty. Lenient — for read-only paths. */
export function parseJsonBlock<T>(content: string | null): T[] {
  if (!content) return [];
  const m = /```json\s*([\s\S]*?)```/.exec(content);
  if (!m) return [];
  try {
    const v = JSON.parse(m[1]);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Same, but throws when a non-empty file doesn't parse. Use before rewriting a file: treating an
 * unreadable ledger as empty would drop every purchase, gacha and claim row already in it.
 */
export function parseJsonBlockStrict<T>(content: string | null, path: string): T[] {
  if (content === null || content.trim() === "") return [];
  const m = /```json\s*([\s\S]*?)```/.exec(content);
  if (!m) throw new Error(`${path}: no json block found — refusing to overwrite`);
  let v: unknown;
  try {
    v = JSON.parse(m[1]);
  } catch (err) {
    throw new Error(`${path}: json block is not valid JSON — refusing to overwrite (${String(err)})`);
  }
  if (!Array.isArray(v)) throw new Error(`${path}: json block is not an array — refusing to overwrite`);
  return v as T[];
}
