import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import admin from "firebase-admin";

type WrestlingStyle = "Freestyle" | "Folkstyle" | "Greco-Roman";

type SourceConfig = {
  channelName: string;
  channelUrl: string;
  filePath: string;
};

type RawVideo = {
  id?: string;
  url?: string;
  title?: string;
  webpage_url?: string;
  description?: string;
  duration?: number;
  thumbnails?: Array<{ url?: string }>;
};

type LibraryItemImport = {
  title: string;
  style: WrestlingStyle;
  category: string;
  subcategory: string;
  format: string;
  videoUrl: string;
  notes: string;
  tags: string[];
  durationMinutes?: number;
  thumbnailUrl?: string;
  source: "youtube_channel_import";
  channelName: string;
  channelUrl: string;
  youtubeVideoId: string;
  createdAt: admin.firestore.FieldValue;
  updatedAt: admin.firestore.FieldValue;
};

const SOURCES: SourceConfig[] = [
  {
    channelName: "Athletes Ocean",
    channelUrl: "https://www.youtube.com/@AthletesOcean/videos",
    filePath: "data/youtube-library/athletes-ocean-videos.jsonl",
  },
  {
    channelName: "Iron Faith Wrestling",
    channelUrl: "https://www.youtube.com/@ironfaithwrestling/videos",
    filePath: "data/youtube-library/iron-faith-videos.jsonl",
  },
  {
    channelName: "Cary Kolat",
    channelUrl: "https://www.youtube.com/@KOLATCOM/videos",
    filePath: "data/youtube-library/kolat-videos.jsonl",
  },
];

const TECHNIQUE_INCLUDE_KEYWORDS = [
  "technique",
  "drill",
  "setup",
  "finish",
  "finishes",
  "single leg",
  "double leg",
  "high crotch",
  "low single",
  "sweep single",
  "ankle pick",
  "shot",
  "shots",
  "takedown",
  "takedowns",
  "sprawl",
  "front headlock",
  "snap down",
  "go behind",
  "duck under",
  "slide by",
  "underhook",
  "overhook",
  "pummel",
  "pummeling",
  "hand fight",
  "hand fighting",
  "mat return",
  "mat returns",
  "escape",
  "stand up",
  "switch",
  "granby",
  "breakdown",
  "ride",
  "riding",
  "turn",
  "turns",
  "tilt",
  "pin",
  "pinning",
  "gut wrench",
  "lace",
  "leg lace",
  "par terre",
  "throw",
  "throws",
  "arm throw",
  "body lock",
  "counter",
  "defense",
  "defending",
  "chain wrestling",
  "scramble",
  "scrambling",
  "position",
  "pressure",
  "claw",
  "cradle",
  "fireman's",
  "fireman",
  "outside step",
  "inside trip",
  "arm drag",
  "re-attack",
  "re attack",
];

const NON_TECHNIQUE_EXCLUDE_KEYWORDS = [
  "interview",
  "podcast",
  "vlog",
  "final",
  "semifinal",
  "semi-final",
  "quarterfinal",
  "highlight",
  "highlights",
  "recap",
  "preview",
  "promo",
  "trailer",
  "live stream",
  "livestream",
  "press conference",
  "weigh in",
  "weigh-in",
  "announcement",
  "behind the scenes",
  "documentary",
  "match",
  "matches",
  "championships",
  "championship",
  "world team trials",
  "olympic trials",
  "open mat",
  "mic'd up",
  "micd up",
  "shorts",
  "#shorts",
];

function getServiceAccount() {
  const fromEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (fromEnv?.trim()) {
    return JSON.parse(fromEnv);
  }

  const envPath = path.resolve(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON and no root .env file was found.");
  }

  const envText = fs.readFileSync(envPath, "utf8");
  const match = envText.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(\{[\s\S]*?\n\})/);

  if (!match?.[1]) {
    throw new Error("Could not find FIREBASE_SERVICE_ACCOUNT_JSON JSON block in root .env.");
  }

  return JSON.parse(match[1]);
}

function initFirebase() {
  if (admin.apps.length > 0) return;

  admin.initializeApp({
    credential: admin.credential.cert(getServiceAccount()),
  });
}

function cleanText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s\-']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function isTechniqueVideo(title: string, description?: string) {
  const cleaned = cleanText(`${title} ${description || ""}`);

  if (!cleaned) return false;
  if (includesAny(cleaned, NON_TECHNIQUE_EXCLUDE_KEYWORDS)) return false;

  return includesAny(cleaned, TECHNIQUE_INCLUDE_KEYWORDS);
}

function inferStyle(
  title: string,
  description: string | undefined,
  channelName: string
): WrestlingStyle {
  const text = cleanText(`${title} ${description || ""} ${channelName}`);

  if (
    text.includes("greco") ||
    text.includes("upper body") ||
    text.includes("pummel") ||
    text.includes("pummeling") ||
    text.includes("arm throw") ||
    text.includes("body lock")
  ) {
    return "Greco-Roman";
  }

  if (
    text.includes("freestyle") ||
    text.includes("gut wrench") ||
    text.includes("leg lace") ||
    text.includes("lace") ||
    text.includes("par terre") ||
    text.includes("exposure")
  ) {
    return "Freestyle";
  }

  return "Folkstyle";
}

function inferCategory(title: string, description?: string) {
  const text = cleanText(`${title} ${description || ""}`);

  if (
    text.includes("single") ||
    text.includes("double") ||
    text.includes("high crotch") ||
    text.includes("low single") ||
    text.includes("shot") ||
    text.includes("takedown") ||
    text.includes("ankle pick")
  ) {
    return "Neutral";
  }

  if (
    text.includes("hand fight") ||
    text.includes("pummel") ||
    text.includes("underhook") ||
    text.includes("overhook") ||
    text.includes("tie") ||
    text.includes("snap")
  ) {
    return "Hand Fighting";
  }

  if (
    text.includes("escape") ||
    text.includes("stand up") ||
    text.includes("switch") ||
    text.includes("granby") ||
    text.includes("bottom")
  ) {
    return "Bottom";
  }

  if (
    text.includes("ride") ||
    text.includes("breakdown") ||
    text.includes("tilt") ||
    text.includes("turn") ||
    text.includes("pin") ||
    text.includes("cradle") ||
    text.includes("top")
  ) {
    return "Top";
  }

  if (
    text.includes("sprawl") ||
    text.includes("defense") ||
    text.includes("counter") ||
    text.includes("defending")
  ) {
    return "Defense";
  }

  if (
    text.includes("throw") ||
    text.includes("body lock") ||
    text.includes("arm throw") ||
    text.includes("inside trip")
  ) {
    return "Throws";
  }

  if (text.includes("gut wrench") || text.includes("lace") || text.includes("par terre")) {
    return "Par Terre";
  }

  return "Technique";
}

function inferSubcategory(title: string, description?: string) {
  const text = cleanText(`${title} ${description || ""}`);

  const options = [
    "single leg",
    "double leg",
    "high crotch",
    "low single",
    "sweep single",
    "ankle pick",
    "front headlock",
    "snap down",
    "duck under",
    "slide by",
    "underhook",
    "mat return",
    "stand up",
    "switch",
    "granby",
    "tilt",
    "cradle",
    "gut wrench",
    "leg lace",
    "arm throw",
    "body lock",
    "sprawl",
    "go behind",
    "chain wrestling",
  ];

  const found = options.find((option) => text.includes(option));
  if (!found) return "General";

  return found
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function buildTags(title: string, description: string | undefined, source: SourceConfig) {
  const text = cleanText(`${title} ${description || ""}`);
  const tags = new Set<string>();

  tags.add(source.channelName);
  tags.add("trusted-channel");
  tags.add("technique");

  TECHNIQUE_INCLUDE_KEYWORDS.forEach((keyword) => {
    if (text.includes(keyword)) tags.add(keyword);
  });

  return Array.from(tags).slice(0, 20);
}

function getVideoUrl(raw: RawVideo) {
  if (raw.webpage_url) return raw.webpage_url;
  if (raw.url?.startsWith("http")) return raw.url;
  if (raw.id) return `https://www.youtube.com/watch?v=${raw.id}`;
  return "";
}

function getThumbnailUrl(raw: RawVideo) {
  const thumbnails = raw.thumbnails || [];
  const last = thumbnails[thumbnails.length - 1];
  return last?.url || "";
}

function readJsonl(filePath: string) {
  const absolute = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(absolute)) {
    throw new Error(`Missing ${filePath}. Run yt-dlp first.`);
  }

  return fs
    .readFileSync(absolute, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RawVideo);
}

function buildLibraryItem(raw: RawVideo, source: SourceConfig): LibraryItemImport | null {
  const title = raw.title?.trim() || "";
  const description = raw.description || "";
  const videoUrl = getVideoUrl(raw);
  const youtubeVideoId = raw.id || "";

  if (!title || !videoUrl || !youtubeVideoId) return null;
  if (!isTechniqueVideo(title, description)) return null;

  const style = inferStyle(title, description, source.channelName);
  const category = inferCategory(title, description);
  const subcategory = inferSubcategory(title, description);

  const durationMinutes =
    typeof raw.duration === "number" && raw.duration > 0
      ? Math.max(1, Math.round(raw.duration / 60))
      : undefined;

  return {
    title,
    style,
    category,
    subcategory,
    format: "Technique Video",
    videoUrl,
    notes: `Imported from ${source.channelName}.`,
    tags: buildTags(title, description, source),
    durationMinutes,
    thumbnailUrl: getThumbnailUrl(raw),
    source: "youtube_channel_import",
    channelName: source.channelName,
    channelUrl: source.channelUrl,
    youtubeVideoId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function deleteExistingLibrary(db: admin.firestore.Firestore) {
  const snapshot = await db.collection("library_items").get();
  let batch = db.batch();
  let count = 0;

  for (const document of snapshot.docs) {
    batch.delete(document.ref);
    count += 1;

    if (count % 450 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }

  await batch.commit();
  return count;
}

async function importLibraryItems(db: admin.firestore.Firestore, items: LibraryItemImport[]) {
  let batch = db.batch();
  let count = 0;

  for (const item of items) {
    const ref = db.collection("library_items").doc(`yt_${item.youtubeVideoId}`);
    batch.set(ref, item, { merge: true });
    count += 1;

    if (count % 450 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }

  await batch.commit();
  return count;
}

async function main() {
  const replace = process.argv.includes("--replace");

  initFirebase();

  const db = admin.firestore();
  const allItems: LibraryItemImport[] = [];
  const seen = new Set<string>();

  for (const source of SOURCES) {
    const rawVideos = readJsonl(source.filePath);
    let kept = 0;

    for (const raw of rawVideos) {
      const item = buildLibraryItem(raw, source);
      if (!item) continue;
      if (seen.has(item.youtubeVideoId)) continue;

      seen.add(item.youtubeVideoId);
      allItems.push(item);
      kept += 1;
    }

    console.log(`${source.channelName}: kept ${kept} technique videos`);
  }

  if (replace) {
    const deleted = await deleteExistingLibrary(db);
    console.log(`Deleted ${deleted} existing library items`);
  }

  const imported = await importLibraryItems(db, allItems);
  console.log(`Imported ${imported} trusted technique videos`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});