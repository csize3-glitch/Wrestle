import fs from "node:fs";
import readline from "node:readline";

type AnyJson = Record<string, any>;

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error(
    "Usage: pnpm tsx scripts/filter-usa-wrestling-library.ts <input.jsonl> <output.jsonl>"
  );
  process.exit(1);
}

const strongKeepTerms = [
  "technique",
  "drill",
  "drills",
  "how to",
  "instruction",
  "instructional",
  "training",
  "practice",
  "setup",
  "set up",
  "finish",
  "finishes",
  "breakdown",
  "positioning",
];

const wrestlingSkillTerms = [
  "single leg",
  "double leg",
  "high crotch",
  "low single",
  "ankle pick",
  "snap down",
  "front headlock",
  "underhook",
  "overhook",
  "two on one",
  "2 on 1",
  "arm drag",
  "duck under",
  "slide by",
  "sprawl",
  "re-attack",
  "counter",
  "defense",
  "stance",
  "motion",
  "level change",
  "shot",
  "takedown",
  "mat return",
  "scramble",
  "short offense",
  "go behind",
  "turn",
  "tilt",
  "ride",
  "escape",
  "reversal",
  "stand up",
  "sit out",
  "granby",
  "switch",
  "leg lace",
  "gut wrench",
  "par terre",
  "lift",
  "throw",
  "body lock",
  "arm spin",
  "headlock",
  "pummel",
  "pummeling",
  "hand fight",
  "hand fighting",
  "clinch",
  "greco",
  "freestyle",
  "folkstyle",
];

const excludeTerms = [
  "interview",
  "podcast",
  "press conference",
  "recap",
  "highlights",
  "highlight",
  "full match",
  "match replay",
  "replay",
  "finals",
  "semifinals",
  "quarterfinals",
  "championships",
  "world championships",
  "olympic trials",
  "team trials",
  "weigh-in",
  "weigh in",
  "ceremony",
  "awards",
  "promo",
  "preview",
  "live stream",
  "livestream",
  "live:",
  "behind the scenes",
  "documentary",
  "press",
  "media day",
];

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function getText(row: AnyJson) {
  const title = normalize(row.title ?? row.name ?? row.videoTitle);
  const description = normalize(row.description ?? row.desc ?? row.videoDescription);
  const tags = Array.isArray(row.tags) ? row.tags.join(" ") : row.tags;
  const channelName = normalize(row.channelName ?? row.channel ?? row.source);

  return {
    title,
    description,
    tags: normalize(tags),
    channelName,
    all: `${title} ${description} ${normalize(tags)} ${channelName}`,
  };
}

function scoreVideo(row: AnyJson) {
  const text = getText(row);
  let score = 0;
  const reasons: string[] = [];

  if (includesAny(text.title, excludeTerms)) {
    score -= 4;
    reasons.push("title_exclude");
  }

  if (includesAny(text.description, excludeTerms)) {
    score -= 2;
    reasons.push("description_exclude");
  }

  if (includesAny(text.title, strongKeepTerms)) {
    score += 4;
    reasons.push("title_strong_keep");
  }

  if (includesAny(text.all, strongKeepTerms)) {
    score += 2;
    reasons.push("any_strong_keep");
  }

  const titleSkillHits = wrestlingSkillTerms.filter((term) => text.title.includes(term));
  const allSkillHits = wrestlingSkillTerms.filter((term) => text.all.includes(term));

  if (titleSkillHits.length > 0) {
    score += Math.min(5, titleSkillHits.length * 2);
    reasons.push(`title_skill:${titleSkillHits.slice(0, 4).join(",")}`);
  }

  if (allSkillHits.length > 0) {
    score += Math.min(4, allSkillHits.length);
    reasons.push(`any_skill:${allSkillHits.slice(0, 4).join(",")}`);
  }

  if (text.title.includes("usa wrestling weekly") || text.title.includes("themat.tv")) {
    score -= 3;
    reasons.push("show_or_media");
  }

  return { score, reasons };
}

function getVideoKey(row: AnyJson) {
  return (
    row.youtubeVideoId ||
    row.videoId ||
    row.id ||
    row.url ||
    row.videoUrl ||
    row.link ||
    JSON.stringify(row).slice(0, 250)
  );
}

async function main() {
  const input = fs.createReadStream(inputPath, { encoding: "utf8" });
  const output = fs.createWriteStream(outputPath, { encoding: "utf8" });

  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });

  const seen = new Set<string>();

  let total = 0;
  let kept = 0;
  let skippedBadJson = 0;
  let duplicates = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    total += 1;

    let row: AnyJson;

    try {
      row = JSON.parse(trimmed);
    } catch {
      skippedBadJson += 1;
      continue;
    }

    const key = getVideoKey(row);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);

    const result = scoreVideo(row);

    if (result.score >= 5) {
      const curatedRow = {
        ...row,
        curationSource: "usa_wrestling_technique_filter",
        curationScore: result.score,
        curationReasons: result.reasons,
      };

      output.write(`${JSON.stringify(curatedRow)}\n`);
      kept += 1;
    }
  }

  output.end();

  console.log("USA Wrestling filter complete");
  console.log(`Input: ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Total rows: ${total}`);
  console.log(`Kept rows: ${kept}`);
  console.log(`Duplicates skipped: ${duplicates}`);
  console.log(`Bad JSON skipped: ${skippedBadJson}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});