"use client";

import { db } from "@wrestlewell/firebase/client";
import { COLLECTIONS, type LibraryItem } from "@wrestlewell/types/index";
import {
  getPositionOptionsForStyle,
  inferLibraryPosition,
  type LibraryPositionGroup,
} from "@wrestlewell/lib/index";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";

type SourceFilter = "" | "youtube_channel_import" | "excel_import" | "manual";

function labelSource(source?: string) {
  if (source === "youtube_channel_import") return "Trusted YouTube";
  if (source === "excel_import") return "Excel Import";
  if (source === "manual") return "Manual";
  return "Unknown";
}

function safeText(value: unknown) {
  return typeof value === "string" ? value : "";
}

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [styleFilter, setStyleFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState<LibraryPositionGroup | "">("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function loadItems() {
      try {
        const q = query(collection(db, COLLECTIONS.LIBRARY_ITEMS), orderBy("title"));
        const snapshot = await getDocs(q);

        const rows = snapshot.docs.map((itemDoc) => ({
          id: itemDoc.id,
          ...(itemDoc.data() as Omit<LibraryItem, "id">),
        })) as LibraryItem[];

        setItems(rows);
      } catch (error) {
        console.error("Failed to load library items:", error);
      } finally {
        setLoading(false);
      }
    }

    loadItems();
  }, []);

  const styles = useMemo(() => {
    return Array.from(new Set(items.map((item) => item.style).filter(Boolean))).sort();
  }, [items]);

  const positionOptions = useMemo(
    () => getPositionOptionsForStyle(styleFilter as LibraryItem["style"] | ""),
    [styleFilter]
  );

  const categories = useMemo(() => {
    return Array.from(new Set(items.map((item) => item.category).filter(Boolean))).sort();
  }, [items]);

  const channels = useMemo(() => {
    return Array.from(
      new Set(items.map((item) => item.channelName).filter((value): value is string => Boolean(value)))
    ).sort();
  }, [items]);

  const sources = useMemo(() => {
    return Array.from(new Set(items.map((item) => item.source).filter(Boolean))).sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return items.filter((item) => {
      const matchesStyle = !styleFilter || item.style === styleFilter;
      const itemPosition = inferLibraryPosition(item);
      const matchesPosition = !positionFilter || itemPosition === positionFilter;
      const matchesCategory = !categoryFilter || item.category === categoryFilter;
      const matchesChannel = !channelFilter || item.channelName === channelFilter;
      const matchesSource = !sourceFilter || item.source === sourceFilter;

      const searchableText = [
        item.title,
        item.style,
        item.category,
        item.subcategory,
        item.format,
        item.notes,
        item.channelName,
        item.channelUrl,
        item.videoUrl,
        ...(Array.isArray(item.tags) ? item.tags : []),
      ]
        .map(safeText)
        .join(" ")
        .toLowerCase();

      const matchesSearch = !needle || searchableText.includes(needle);

      return (
        matchesStyle &&
        matchesPosition &&
        matchesCategory &&
        matchesChannel &&
        matchesSource &&
        matchesSearch
      );
    });
  }, [items, positionFilter, styleFilter, categoryFilter, channelFilter, sourceFilter, search]);

  const trustedCount = useMemo(
    () => items.filter((item) => item.source === "youtube_channel_import").length,
    [items]
  );

  function clearFilters() {
    setStyleFilter("");
    setPositionFilter("");
    setCategoryFilter("");
    setChannelFilter("");
    setSourceFilter("");
    setSearch("");
  }

  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Technique Library</h1>

      <p style={{ marginBottom: 24 }}>
        Showing trusted wrestling technique videos from your approved channels.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {[
          { label: "Total Videos", value: String(items.length) },
          { label: "Trusted YouTube", value: String(trustedCount) },
          { label: "Showing", value: String(filteredItems.length) },
          { label: "Channels", value: String(channels.length) },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 14,
              background: "#fff",
            }}
          >
            <div
              style={{
                fontSize: 12,
                textTransform: "uppercase",
                color: "#666",
                marginBottom: 6,
                fontWeight: 700,
              }}
            >
              {stat.label}
            </div>

            <strong style={{ fontSize: 20 }}>{stat.value}</strong>
          </div>
        ))}
      </div>

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          background: "#fff",
          marginBottom: 24,
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Filters</h2>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <select
            value={styleFilter}
            onChange={(event) => {
              setStyleFilter(event.target.value);
              setPositionFilter("");
            }}
            style={{ padding: 10, minWidth: 180 }}
          >
            <option value="">All Styles</option>
            {styles.map((style) => (
              <option key={style} value={style}>
                {style}
              </option>
            ))}
          </select>

          <select
            value={positionFilter}
            onChange={(event) => setPositionFilter(event.target.value as LibraryPositionGroup | "")}
            style={{ padding: 10, minWidth: 180 }}
          >
            <option value="">All Positions</option>
            {positionOptions.map((position) => (
              <option key={position} value={position}>
                {position}
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            style={{ padding: 10, minWidth: 180 }}
          >
            <option value="">All Categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>

          <select
            value={channelFilter}
            onChange={(event) => setChannelFilter(event.target.value)}
            style={{ padding: 10, minWidth: 200 }}
          >
            <option value="">All Channels</option>
            {channels.map((channel) => (
              <option key={channel} value={channel}>
                {channel}
              </option>
            ))}
          </select>

          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
            style={{ padding: 10, minWidth: 180 }}
          >
            <option value="">All Sources</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {labelSource(source)}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Search title, channel, category, tags..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ padding: 10, minWidth: 280, flex: 1 }}
          />

          <button
            type="button"
            onClick={clearFilters}
            style={{ padding: "10px 14px", cursor: "pointer" }}
          >
            Clear Filters
          </button>
        </div>
      </section>

      {loading ? (
        <p>Loading library...</p>
      ) : filteredItems.length === 0 ? (
        <div
          style={{
            border: "1px dashed #ccc",
            borderRadius: 12,
            padding: 24,
            background: "#fafafa",
            color: "#666",
          }}
        >
          No videos match the current filters.
        </div>
      ) : (
        <>
          <p style={{ marginBottom: 16 }}>{filteredItems.length} items found</p>

          <div style={{ display: "grid", gap: 16 }}>
            {filteredItems.map((item) => {
              const position = inferLibraryPosition(item);

              return (
                <article
                  key={item.id || item.videoUrl}
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 12,
                    padding: 16,
                    background: "#fff",
                    display: "grid",
                    gridTemplateColumns: item.thumbnailUrl ? "180px 1fr" : "1fr",
                    gap: 16,
                    alignItems: "start",
                  }}
                >
                  {item.thumbnailUrl ? (
                    <a href={item.videoUrl} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.thumbnailUrl}
                        alt={item.title}
                        style={{
                          width: "100%",
                          borderRadius: 10,
                          border: "1px solid #eee",
                          display: "block",
                        }}
                      />
                    </a>
                  ) : null}

                  <div>
                    <div style={{ marginBottom: 8 }}>
                      <strong style={{ fontSize: 18 }}>{item.title}</strong>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        marginBottom: 10,
                      }}
                    >
                      {[
                        item.style,
                        position,
                        item.category,
                        item.subcategory,
                        item.channelName,
                        labelSource(item.source),
                      ]
                        .filter(Boolean)
                        .map((label) => (
                          <span
                            key={`${item.id}-${label}`}
                            style={{
                              border: "1px solid #d1d5db",
                              borderRadius: 999,
                              padding: "5px 9px",
                              fontSize: 12,
                              background: "#f8fafc",
                              color: "#334155",
                              fontWeight: 700,
                            }}
                          >
                            {label}
                          </span>
                        ))}
                    </div>

                    <div style={{ marginBottom: 8, fontSize: 14, lineHeight: 1.6 }}>
                      <span>
                        <strong>Style:</strong> {item.style}
                      </span>{" "}
                      <span>
                        <strong>Position:</strong> {position}
                      </span>{" "}
                      <span>
                        <strong>Category:</strong> {item.category}
                      </span>{" "}
                      <span>
                        <strong>Subcategory:</strong> {item.subcategory}
                      </span>{" "}
                      <span>
                        <strong>Format:</strong> {item.format}
                      </span>
                    </div>

                    {item.channelName ? (
                      <div style={{ marginBottom: 8, fontSize: 14 }}>
                        <strong>Channel:</strong>{" "}
                        {item.channelUrl ? (
                          <a href={item.channelUrl} target="_blank" rel="noreferrer">
                            {item.channelName}
                          </a>
                        ) : (
                          item.channelName
                        )}
                      </div>
                    ) : null}

                    {item.durationMinutes ? (
                      <div style={{ marginBottom: 8, fontSize: 14 }}>
                        <strong>Duration:</strong> about {item.durationMinutes} min
                      </div>
                    ) : null}

                    {item.notes ? <p style={{ marginBottom: 8 }}>{item.notes}</p> : null}

                    {Array.isArray(item.tags) && item.tags.length > 0 ? (
                      <div style={{ marginBottom: 12, fontSize: 13, color: "#666" }}>
                        <strong>Tags:</strong> {item.tags.slice(0, 10).join(", ")}
                      </div>
                    ) : null}

                    <a href={item.videoUrl} target="_blank" rel="noreferrer">
                      Open video
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}