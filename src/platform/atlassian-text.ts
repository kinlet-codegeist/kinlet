export type AdfNode = {
  version?: number;
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

export function plainText(node: AdfNode | null): string {
  if (!node) return "";
  const children = (node.content ?? []).map(plainText);
  switch (node.type) {
    case "text": {
      const value = node.text ?? "";
      const href = node.marks?.find((m) => m.type === "link")?.attrs?.href;
      return typeof href === "string" && href !== value
        ? value + " (" + href + ")"
        : value;
    }
    case "hardBreak":
      return "\n";
    case "mention":
      return String(node.attrs?.text ?? "@mention");
    case "emoji":
      return String(node.attrs?.text ?? node.attrs?.shortName ?? "");
    case "inlineCard":
    case "blockCard":
      return String(node.attrs?.url ?? "");
    case "status":
      return String(node.attrs?.text ?? "");
    case "date": {
      const date = new Date(Number(node.attrs?.timestamp));
      return Number.isNaN(date.valueOf())
        ? ""
        : date.toISOString().slice(0, 10);
    }
    case "bulletList":
      return children.map((s) => "• " + s).join("\n");
    case "orderedList":
      return children
        .map((s, i) => Number(node.attrs?.order ?? 1) + i + ". " + s)
        .join("\n");
    case "tableRow":
      return children.join("\t");
    case "paragraph":
    case "heading":
    case "codeBlock":
      return children.join("");
    case "rule":
      return "—";
    case "media":
    case "mediaInline":
      return String(node.attrs?.alt ?? "[Media]");
    default:
      return children.join("\n");
  }
}
