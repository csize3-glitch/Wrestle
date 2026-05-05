import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { db } from "@wrestlewell/firebase/client";
import {
  listPracticeAttendanceForWrestlers,
  listWrestlersByIds,
} from "@wrestlewell/lib/index";
import type { PracticeAttendanceRecord, WrestlerProfile } from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { MobileScreenShell } from "../components/mobile-screen-shell";

function formatPeriodDate(value: Date) {
  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function getFullName(wrestler: Pick<WrestlerProfile, "firstName" | "lastName">) {
  return `${wrestler.firstName} ${wrestler.lastName}`.trim() || "Unnamed Wrestler";
}

function countStatuses(rows: PracticeAttendanceRecord[]) {
  return rows.reduce(
    (totals, row) => {
      totals[row.status] += 1;
      return totals;
    },
    {
      present: 0,
      absent: 0,
      late: 0,
      injured: 0,
      excused: 0,
      not_sure: 0,
      not_checked_in: 0,
    } satisfies Record<PracticeAttendanceRecord["status"], number>
  );
}

export default function ParentAttendanceScreen() {
  const { appUser, currentTeam } = useMobileAuthState();
  const [loading, setLoading] = useState(true);
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [attendance, setAttendance] = useState<PracticeAttendanceRecord[]>([]);

  const isParent = appUser?.role === "parent";

  useEffect(() => {
    async function load() {
      if (!isParent || !currentTeam?.id) {
        setWrestlers([]);
        setAttendance([]);
        setLoading(false);
        return;
      }

      const linkedIds = appUser.linkedWrestlerIds || [];
      if (!linkedIds.length) {
        setWrestlers([]);
        setAttendance([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const [wrestlerRows, attendanceRows] = await Promise.all([
          listWrestlersByIds(db, linkedIds),
          listPracticeAttendanceForWrestlers(db, currentTeam.id, linkedIds),
        ]);
        setWrestlers(wrestlerRows);
        setAttendance(attendanceRows);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [appUser?.linkedWrestlerIds, currentTeam?.id, isParent]);

  const last30Start = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date;
  }, []);

  const byWrestler = useMemo(
    () =>
      wrestlers.map((wrestler) => {
        const wrestlerRows = attendance.filter((row) => row.wrestlerId === wrestler.id);
        const last30Rows = wrestlerRows.filter((row) => {
          const date = new Date(`${row.date}T12:00:00`);
          return !Number.isNaN(date.getTime()) && date >= last30Start;
        });
        const allCounts = countStatuses(wrestlerRows);
        const last30Counts = countStatuses(last30Rows);
        const seasonTotal = wrestlerRows.length;
        const last30Total = last30Rows.length;
        const attendanceRate = seasonTotal
          ? Math.round(((allCounts.present + allCounts.late) / seasonTotal) * 100)
          : 0;

        return {
          wrestler,
          allCounts,
          last30Counts,
          seasonTotal,
          last30Total,
          attendanceRate,
        };
      }),
    [attendance, last30Start, wrestlers]
  );

  return (
    <MobileScreenShell
      title="Parent Attendance"
      subtitle="Review recent practice attendance for linked wrestlers without opening coach tools."
    >
      {!isParent ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#21486e",
            borderRadius: 20,
            padding: 18,
            backgroundColor: "#0b2542",
          }}
        >
          <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
            Parent access required
          </Text>
          <Text style={{ color: "#b7c9df", lineHeight: 22, marginTop: 8 }}>
            This attendance history is only available to parent or guardian accounts.
          </Text>
        </View>
      ) : loading ? (
        <Text style={{ color: "#b7c9df" }}>Loading attendance...</Text>
      ) : wrestlers.length === 0 ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#21486e",
            borderRadius: 20,
            padding: 18,
            backgroundColor: "#0b2542",
          }}
        >
          <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
            No linked wrestlers yet
          </Text>
          <Text style={{ color: "#b7c9df", lineHeight: 22, marginTop: 8 }}>
            Ask your coach to link your wrestler before attendance history appears here.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 16, paddingBottom: 28 }}>
          <Text style={{ color: "#b7c9df", lineHeight: 22 }}>
            Last 30 days covers {formatPeriodDate(last30Start)} through today. Season totals include every attendance record currently linked to your wrestlers.
          </Text>

          {byWrestler.map(({ wrestler, allCounts, last30Counts, seasonTotal, last30Total, attendanceRate }) => (
            <View
              key={wrestler.id}
              style={{
                borderWidth: 1,
                borderColor: "#21486e",
                borderRadius: 20,
                padding: 18,
                backgroundColor: "#0b2542",
                gap: 14,
              }}
            >
              <View style={{ gap: 4 }}>
                <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
                  {getFullName(wrestler)}
                </Text>
                <Text style={{ color: "#b7c9df" }}>
                  Attendance rate: {attendanceRate}% · Season records: {seasonTotal}
                </Text>
              </View>

              <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
                <View style={{ minWidth: 130 }}>
                  <Text style={{ color: "#93c5fd", fontWeight: "800", marginBottom: 6 }}>
                    Last 30 days ({last30Total})
                  </Text>
                  <Text style={{ color: "#b7c9df" }}>Present: {last30Counts.present}</Text>
                  <Text style={{ color: "#b7c9df" }}>Late: {last30Counts.late}</Text>
                  <Text style={{ color: "#b7c9df" }}>Absent: {last30Counts.absent}</Text>
                  <Text style={{ color: "#b7c9df" }}>Injured/Excused: {last30Counts.injured + last30Counts.excused}</Text>
                  <Text style={{ color: "#b7c9df" }}>Not sure / missed: {last30Counts.not_sure + last30Counts.not_checked_in}</Text>
                </View>

                <View style={{ minWidth: 130 }}>
                  <Text style={{ color: "#93c5fd", fontWeight: "800", marginBottom: 6 }}>
                    Season total
                  </Text>
                  <Text style={{ color: "#b7c9df" }}>Present: {allCounts.present}</Text>
                  <Text style={{ color: "#b7c9df" }}>Late: {allCounts.late}</Text>
                  <Text style={{ color: "#b7c9df" }}>Absent: {allCounts.absent}</Text>
                  <Text style={{ color: "#b7c9df" }}>Injured/Excused: {allCounts.injured + allCounts.excused}</Text>
                  <Text style={{ color: "#b7c9df" }}>Not sure / missed: {allCounts.not_sure + allCounts.not_checked_in}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </MobileScreenShell>
  );
}
