// Minimal, safe XML serializer for customer exports. Keys starting with "@" become attributes; arrays repeat the element.
const esc = (v: unknown) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
const name = (k: string) => k.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^([^A-Za-z_])/, "_$1");

function el(tag: string, v: unknown, indent: string): string {
  if (Array.isArray(v)) return v.map(x => el(tag, x, indent)).join("");
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const attrs = Object.entries(o).filter(([k]) => k.startsWith("@")).map(([k, a]) => ` ${name(k.slice(1))}="${esc(a)}"`).join("");
    const kids = Object.entries(o).filter(([k]) => !k.startsWith("@"));
    if (!kids.length) return `${indent}<${name(tag)}${attrs}/>\n`;
    return `${indent}<${name(tag)}${attrs}>\n${kids.map(([k, x]) => el(k, x, indent + "  ")).join("")}${indent}</${name(tag)}>\n`;
  }
  return `${indent}<${name(tag)}>${esc(typeof v === "bigint" ? v.toString() : v)}</${name(tag)}>\n`;
}

export function toXml(root: string, body: Record<string, unknown>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${el(root, body, "")}`;
}
