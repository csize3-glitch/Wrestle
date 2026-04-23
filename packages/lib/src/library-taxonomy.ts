import type { LibraryItem, WrestlingStyle } from "@wrestlewell/types/index";

export type LibraryPositionGroup =
  | "Neutral"
  | "Top"
  | "Bottom"
  | "Par Terre"
  | "General";

function toNeedle(...values: Array<string | undefined>) {
  return values
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function getPositionOptionsForStyle(style: WrestlingStyle | ""): LibraryPositionGroup[] {
  if (style === "Folkstyle") {
    return ["Neutral", "Top", "Bottom", "General"];
  }

  if (style === "Freestyle" || style === "Greco-Roman") {
    return ["Neutral", "Par Terre", "General"];
  }

  return ["Neutral", "Top", "Bottom", "Par Terre", "General"];
}

export function inferLibraryPosition(item: Pick<LibraryItem, "style" | "category" | "subcategory" | "title" | "notes" | "tags">): LibraryPositionGroup {
  const needle = toNeedle(
    item.category,
    item.subcategory,
    item.title,
    item.notes,
    ...(item.tags || [])
  );

  if (item.style === "Folkstyle") {
    if (/(bottom|stand ?up|sit ?out|granby|switch|escape|reversal|down position)/.test(needle)) {
      return "Bottom";
    }

    if (/(top|ride|breakdown|tilt|pinning|cradle|leg ride|turn)/.test(needle)) {
      return "Top";
    }

    if (/(neutral|shot|takedown|tie|front headlock|snap|single|double|sweep)/.test(needle)) {
      return "Neutral";
    }

    return "General";
  }

  if (item.style === "Freestyle" || item.style === "Greco-Roman") {
    if (/(par terre|gut|leg lace|turn|lift|trap arm|reverse lift|exposure)/.test(needle)) {
      return "Par Terre";
    }

    if (/(neutral|arm drag|shot|takedown|throw|tie|pummel|underhook|front headlock|snap)/.test(needle)) {
      return "Neutral";
    }

    return "General";
  }

  return "General";
}
