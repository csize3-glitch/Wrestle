"use client";

import { db } from "@wrestlewell/firebase/client";
import { COLLECTIONS, type LibraryItem } from "@wrestlewell/types/index";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [styleFilter, setStyleFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function loadItems() {
      try {
        const q = query(collection(db, COLLECTIONS.LIBRARY_ITEMS), orderBy("title"));
        const snapshot = await getDocs(q);
        const rows = snapshot.docs.map((doc) => doc.data() as LibraryItem);
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
    return Array.from(new Set(items.map((item) => item.style))).sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesStyle = !styleFilter || item.style === styleFilter;
      const needle = search.trim().toLowerCase();

      const matchesSearch =
        !needle ||
        item.title.toLowerCase().includes(needle) ||
        item.category.toLowerCase().includes(needle) ||
        item.subcategory.toLowerCase().includes(needle) ||
        item.format.toLowerCase().includes(needle) ||
        item.notes.toLowerCase().includes(needle);

      return matchesStyle && matchesSearch;
    });
  }, [items, styleFilter, search]);

  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Technique Library</h1>
      <p style={{ marginBottom: 24 }}>
        Showing imported wrestling drills and techniques from Firestore.
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <select
          value={styleFilter}
          onChange={(e) => setStyleFilter(e.target.value)}
          style={{ padding: 10, minWidth: 180 }}
        >
          <option value="">All Styles</option>
          {styles.map((style) => (
            <option key={style} value={style}>
              {style}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Search title, category, subcategory..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: 10, minWidth: 280 }}
        />
      </div>

      {loading ? (
        <p>Loading library...</p>
      ) : (
        <>
          <p style={{ marginBottom: 16 }}>{filteredItems.length} items found</p>

          <div style={{ display: "grid", gap: 16 }}>
            {filteredItems.map((item) => (
              <div
                key={item.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 12,
                  padding: 16,
                  background: "#fff",
                }}
              >
                <div style={{ marginBottom: 8 }}>
                  <strong style={{ fontSize: 18 }}>{item.title}</strong>
                </div>

                <div style={{ marginBottom: 8, fontSize: 14 }}>
                  <span><strong>Style:</strong> {item.style}</span>{" "}
                  <span><strong>Category:</strong> {item.category}</span>{" "}
                  <span><strong>Subcategory:</strong> {item.subcategory}</span>{" "}
                  <span><strong>Format:</strong> {item.format}</span>
                </div>

                {item.notes ? (
                  <p style={{ marginBottom: 8 }}>{item.notes}</p>
                ) : null}

                <a href={item.videoUrl} target="_blank" rel="noreferrer">
                  Open video
                </a>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}