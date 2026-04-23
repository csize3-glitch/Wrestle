import type { LibraryItem, WrestlingStyle } from "../../types/src/index";

export const SHEET_TO_STYLE: Record<string, WrestlingStyle> = {
  "Freestyle Drill Links": "Freestyle",
  "Folkstyle Drill Links": "Folkstyle",
  "Greco-Roman Drill Links": "Greco-Roman",
};

export interface ImportedExcelRow {
  Category?: string;
  Subcategory?: string;
  Format?: string;
  "Video Title"?: string;
  "YouTube URL"?: string;
  Notes?: string;
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function makeLibraryItemId(style: string, title: string, videoUrl: string): string {
  const base = `${style}__${title}__${videoUrl}`.toLowerCase();
  return base
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

export function buildTags(style: WrestlingStyle, category: string, subcategory: string, format: string): string[] {
  return [style, category, subcategory, format]
    .map(normalizeText)
    .filter(Boolean)
    .map((v) => v.toLowerCase());
}

export function buildLibraryItemFromRow(
  row: ImportedExcelRow,
  style: WrestlingStyle,
  nowIso: string,
): LibraryItem | null {
  const title = normalizeText(row["Video Title"]);
  const videoUrl = normalizeText(row["YouTube URL"]);
  const category = normalizeText(row.Category);
  const subcategory = normalizeText(row.Subcategory);
  const format = normalizeText(row.Format);
  const notes = normalizeText(row.Notes);

  if (!title || !videoUrl) return null;

  return {
    id: makeLibraryItemId(style, title, videoUrl),
    title,
    style,
    category,
    subcategory,
    format: format || "Other",
    videoUrl,
    notes,
    tags: buildTags(style, category, subcategory, format || "Other"),
    source: "excel_import",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
