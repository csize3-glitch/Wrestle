import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import {
  COLLECTIONS,
  type TournamentEntry,
  type TournamentMatch,
  type TournamentMatchMethod,
  type TournamentMatchStatus,
} from "@wrestlewell/types/index";

export type TournamentMatchInput = {
  teamId: string;
  tournamentId: string;
  tournamentEntryId: string;
  wrestlerId: string;

  boutNumber?: string;
  matNumber?: string;
  roundName?: string;

  opponentName?: string;
  opponentTeam?: string;

  status?: TournamentMatchStatus;

  result?: "win" | "loss";
  score?: string;
  method?: TournamentMatchMethod;
  notes?: string;
};

export type ParsedBracketMatch = {
  id: string;
  boutNumber?: string;
  matNumber?: string;
  roundName?: string;

  wrestlerName?: string;
  wrestlerClub?: string;
  opponentName?: string;
  opponentTeam?: string;

  resultText?: string;
  status: TournamentMatchStatus;

  matchedEntryId?: string;
  matchedWrestlerId?: string;
  confidence: number;
  sourceText: string;
};

const IGNORE_LINES = new Set([
  "bye",
  "_",
  "champion",
  "3rd",
  "1st",
  "2nd",
  "4th",
]);

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStatus(value: unknown): TournamentMatchStatus {
  if (value === "onDeck" || value === "completed" || value === "upcoming") {
    return value;
  }

  return "upcoming";
}

function normalizeMethod(value: unknown): TournamentMatchMethod | undefined {
  if (
    value === "decision" ||
    value === "major" ||
    value === "tech" ||
    value === "fall" ||
    value === "forfeit" ||
    value === "medical" ||
    value === "other"
  ) {
    return value;
  }

  return undefined;
}

function normalizeTournamentMatch(id: string, value: Record<string, unknown>): TournamentMatch {
  return {
    id,
    teamId: normalizeText(value.teamId),
    tournamentId: normalizeText(value.tournamentId),
    tournamentEntryId: normalizeText(value.tournamentEntryId),
    wrestlerId: normalizeText(value.wrestlerId),

    boutNumber: normalizeText(value.boutNumber) || undefined,
    matNumber: normalizeText(value.matNumber) || undefined,
    roundName: normalizeText(value.roundName) || undefined,

    opponentName: normalizeText(value.opponentName) || undefined,
    opponentTeam: normalizeText(value.opponentTeam) || undefined,

    status: normalizeStatus(value.status),

    result: value.result === "win" || value.result === "loss" ? value.result : undefined,
    score: normalizeText(value.score) || undefined,
    method: normalizeMethod(value.method),
    notes: normalizeText(value.notes) || undefined,

    createdAt: normalizeText(value.createdAt),
    updatedAt: normalizeText(value.updatedAt),
  };
}

function cleanName(value: string) {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getDisplayNameFromBracketLine(line: string) {
  return line
    .replace(/\([^)]*\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isBoutNumber(line: string) {
  return /^\d{3,5}$/.test(line.trim());
}

function isResultLine(line: string) {
  const trimmed = line.trim();

  return (
    /^TF\s+\d+\s*-\s*\d+/i.test(trimmed) ||
    /^Dec\s+\d+\s*-\s*\d+/i.test(trimmed) ||
    /^Maj\s+\d+\s*-\s*\d+/i.test(trimmed) ||
    /^MD\s+\d+\s*-\s*\d+/i.test(trimmed) ||
    /^F\s+\d+:\d+/i.test(trimmed) ||
    /^Fall\s+\d+:\d+/i.test(trimmed) ||
    /^Forfeit/i.test(trimmed) ||
    /^Inj/i.test(trimmed)
  );
}

function isClubLine(line: string) {
  const trimmed = line.trim();

  if (!trimmed) return false;
  if (trimmed.includes("http")) return false;
  if (isBoutNumber(trimmed)) return false;
  if (isResultLine(trimmed)) return false;

  const lower = trimmed.toLowerCase();
  if (IGNORE_LINES.has(lower)) return false;
  if (lower.startsWith("loser of")) return false;

  return trimmed.length <= 24 && /^[a-z0-9\s.'-]+$/i.test(trimmed);
}

function isAthleteLine(line: string) {
  const trimmed = line.trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed) return false;
  if (IGNORE_LINES.has(lower)) return false;
  if (lower.startsWith("loser of")) return false;
  if (isBoutNumber(trimmed)) return false;
  if (isResultLine(trimmed)) return false;

  if (trimmed.includes("usabracketing.com/athletes")) return true;

  const words = trimmed.split(/\s+/);
  if (words.length >= 2 && words.length <= 4 && /^[a-zA-Z.'-]+(\s+[a-zA-Z.'-]+)+$/.test(trimmed)) {
    return true;
  }

  return false;
}

function resultToMethod(resultText?: string): TournamentMatchMethod | undefined {
  if (!resultText) return undefined;

  const lower = resultText.toLowerCase();

  if (lower.startsWith("tf")) return "tech";
  if (lower.startsWith("dec")) return "decision";
  if (lower.startsWith("maj") || lower.startsWith("md")) return "major";
  if (lower.startsWith("f ") || lower.startsWith("fall")) return "fall";
  if (lower.startsWith("forfeit")) return "forfeit";
  if (lower.startsWith("inj")) return "medical";

  return "other";
}

function resultToScore(resultText?: string) {
  if (!resultText) return undefined;

  const scoreMatch = resultText.match(/\d+\s*-\s*\d+/);
  return scoreMatch?.[0]?.replace(/\s+/g, "") || undefined;
}

function findConfirmedEntryForName(
  name: string,
  confirmedEntries: TournamentEntry[]
): { entry: TournamentEntry; confidence: number } | null {
  const cleaned = cleanName(name);
  if (!cleaned) return null;

  let best: { entry: TournamentEntry; confidence: number } | null = null;

  for (const entry of confirmedEntries) {
    const entryName = cleanName(entry.wrestlerName || "");
    if (!entryName) continue;

    let confidence = 0;

    if (entryName === cleaned) {
      confidence = 100;
    } else if (entryName.includes(cleaned) || cleaned.includes(entryName)) {
      confidence = 86;
    } else {
      const entryParts = entryName.split(" ").filter(Boolean);
      const cleanedParts = cleaned.split(" ").filter(Boolean);

      const entryLast = entryParts[entryParts.length - 1];
      const cleanedLast = cleanedParts[cleanedParts.length - 1];

      const entryFirst = entryParts[0];
      const cleanedFirst = cleanedParts[0];

      if (entryLast && cleanedLast && entryLast === cleanedLast) {
        confidence += 55;
      }

      if (entryFirst && cleanedFirst && entryFirst[0] === cleanedFirst[0]) {
        confidence += 25;
      }

      const overlap = cleanedParts.filter((part) => entryParts.includes(part)).length;
      confidence += overlap * 10;
    }

    if (!best || confidence > best.confidence) {
      best = { entry, confidence };
    }
  }

  return best && best.confidence >= 70 ? best : null;
}

function windowAround(lines: string[], index: number, before = 6, after = 8) {
  const start = Math.max(0, index - before);
  const end = Math.min(lines.length, index + after + 1);
  return lines.slice(start, end);
}

function extractAthletesFromWindow(lines: string[]) {
  const athletes: Array<{ name: string; club?: string; rawLine: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isAthleteLine(line)) continue;

    const name = getDisplayNameFromBracketLine(line);
    if (!name) continue;

    const nextLine = lines[index + 1] || "";
    const club = isClubLine(nextLine) ? nextLine.trim() : undefined;

    const duplicate = athletes.some((athlete) => cleanName(athlete.name) === cleanName(name));
    if (duplicate) continue;

    athletes.push({ name, club, rawLine: line });
  }

  return athletes;
}

function extractResultFromWindow(lines: string[]) {
  return lines.find((line) => isResultLine(line))?.trim();
}

function extractRoundFromWindow(lines: string[]) {
  const roundLine = lines.find((line) => {
    const lower = line.toLowerCase();
    return lower.includes("quarter") || lower.includes("semi") || lower.includes("final") || lower.includes("cons");
  });

  return roundLine?.trim();
}

export function parseBracketTextToMatches(
  rawText: string,
  confirmedEntries: TournamentEntry[] = []
): ParsedBracketMatch[] {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed: ParsedBracketMatch[] = [];

  lines.forEach((line, index) => {
    if (!isBoutNumber(line)) return;

    const boutNumber = line.trim();
    const nearby = windowAround(lines, index);
    const athletes = extractAthletesFromWindow(nearby);
    const resultText = extractResultFromWindow(nearby);
    const roundName = extractRoundFromWindow(nearby);

    if (athletes.length === 0 && !resultText) return;

    let wrestlerName = athletes[0]?.name;
    let wrestlerClub = athletes[0]?.club;
    let opponentName = athletes[1]?.name;
    let opponentTeam = athletes[1]?.club;

    let matchedEntry = wrestlerName
      ? findConfirmedEntryForName(wrestlerName, confirmedEntries)
      : null;

    if (!matchedEntry && opponentName) {
      const opponentMatchedEntry = findConfirmedEntryForName(opponentName, confirmedEntries);

      if (opponentMatchedEntry) {
        matchedEntry = opponentMatchedEntry;

        const originalWrestlerName = wrestlerName;
        const originalWrestlerClub = wrestlerClub;

        wrestlerName = opponentName;
        wrestlerClub = opponentTeam;
        opponentName = originalWrestlerName;
        opponentTeam = originalWrestlerClub;
      }
    }

    const status: TournamentMatchStatus = resultText ? "completed" : "upcoming";

    parsed.push({
      id: `parsed-${boutNumber}-${index}`,
      boutNumber,
      roundName,
      wrestlerName,
      wrestlerClub,
      opponentName,
      opponentTeam,
      resultText,
      status,
      matchedEntryId: matchedEntry?.entry.id,
      matchedWrestlerId: matchedEntry?.entry.wrestlerId,
      confidence: matchedEntry?.confidence || 0,
      sourceText: nearby.join("\n"),
    });
  });

  const seen = new Set<string>();

  return parsed.filter((match) => {
    const key = `${match.boutNumber || ""}:${cleanName(match.wrestlerName || "")}:${cleanName(
      match.opponentName || ""
    )}`;

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function listTournamentMatches(
  db: Firestore,
  args: {
    teamId: string;
    tournamentId: string;
    tournamentEntryId?: string;
    wrestlerId?: string;
  }
): Promise<TournamentMatch[]> {
  const filters = [
    where("teamId", "==", args.teamId),
    where("tournamentId", "==", args.tournamentId),
  ];

  if (args.tournamentEntryId) {
    filters.push(where("tournamentEntryId", "==", args.tournamentEntryId));
  }

  if (args.wrestlerId) {
    filters.push(where("wrestlerId", "==", args.wrestlerId));
  }

  const snapshot = await getDocs(query(collection(db, COLLECTIONS.TOURNAMENT_MATCHES), ...filters));

  return snapshot.docs
    .map((matchDoc) =>
      normalizeTournamentMatch(matchDoc.id, matchDoc.data() as Record<string, unknown>)
    )
    .sort((a, b) => {
      const statusOrder = { onDeck: 0, upcoming: 1, completed: 2 };
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;

      const aBout = Number(a.boutNumber || "999999");
      const bBout = Number(b.boutNumber || "999999");

      if (Number.isFinite(aBout) && Number.isFinite(bBout) && aBout !== bBout) {
        return aBout - bBout;
      }

      return (a.opponentName || "").localeCompare(b.opponentName || "");
    });
}

export async function createTournamentMatch(
  db: Firestore,
  input: TournamentMatchInput
): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.TOURNAMENT_MATCHES), {
    teamId: input.teamId,
    tournamentId: input.tournamentId,
    tournamentEntryId: input.tournamentEntryId,
    wrestlerId: input.wrestlerId,

    boutNumber: input.boutNumber?.trim() || "",
    matNumber: input.matNumber?.trim() || "",
    roundName: input.roundName?.trim() || "",

    opponentName: input.opponentName?.trim() || "",
    opponentTeam: input.opponentTeam?.trim() || "",

    status: input.status || "upcoming",

    result: input.result || "",
    score: input.score?.trim() || "",
    method: input.method || "",
    notes: input.notes?.trim() || "",

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return ref.id;
}

export async function updateTournamentMatch(
  db: Firestore,
  matchId: string,
  input: Partial<TournamentMatchInput>
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.TOURNAMENT_MATCHES, matchId), {
    ...(input.boutNumber !== undefined ? { boutNumber: input.boutNumber.trim() } : {}),
    ...(input.matNumber !== undefined ? { matNumber: input.matNumber.trim() } : {}),
    ...(input.roundName !== undefined ? { roundName: input.roundName.trim() } : {}),

    ...(input.opponentName !== undefined ? { opponentName: input.opponentName.trim() } : {}),
    ...(input.opponentTeam !== undefined ? { opponentTeam: input.opponentTeam.trim() } : {}),

    ...(input.status !== undefined ? { status: input.status } : {}),

    ...(input.result !== undefined ? { result: input.result } : {}),
    ...(input.score !== undefined ? { score: input.score.trim() } : {}),
    ...(input.method !== undefined ? { method: input.method } : {}),
    ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),

    updatedAt: serverTimestamp(),
  });
}

export async function deleteTournamentMatch(db: Firestore, matchId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.TOURNAMENT_MATCHES, matchId));
}

export function buildTournamentMatchInputFromParsedMatch(args: {
  teamId: string;
  tournamentId: string;
  entry: TournamentEntry;
  parsedMatch: ParsedBracketMatch;
}): TournamentMatchInput {
  return {
    teamId: args.teamId,
    tournamentId: args.tournamentId,
    tournamentEntryId: args.entry.id,
    wrestlerId: args.entry.wrestlerId,

    boutNumber: args.parsedMatch.boutNumber,
    matNumber: args.parsedMatch.matNumber,
    roundName: args.parsedMatch.roundName,

    opponentName: args.parsedMatch.opponentName,
    opponentTeam: args.parsedMatch.opponentTeam,

    status: args.parsedMatch.status,

    score: resultToScore(args.parsedMatch.resultText),
    method: resultToMethod(args.parsedMatch.resultText),
    notes: args.parsedMatch.resultText ? `Imported result: ${args.parsedMatch.resultText}` : "",
  };
}