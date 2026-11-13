import fs from "node:fs";
import test, {
  after,
  before,
  beforeEach,
} from "node:test";
import assert from "node:assert/strict";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const PROJECT_ID = "wrestlewell-rules-test";

let testEnv: RulesTestEnvironment;

const TEAM_A = "team-a";
const TEAM_B = "team-b";

const OWNER_A = "owner-a";
const ASSISTANT_A = "assistant-a";
const ATHLETE_A = "athlete-a";
const PARENT_A = "parent-a";
const ATHLETE_B = "athlete-b";
const SUSPENDED_A = "suspended-a";
const LEGACY_A = "legacy-a";

async function seedData(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(
    async (context) => {
      const db = context.firestore();

      await setDoc(doc(db, "teams", TEAM_A), {
        name: "Team A",
        ownerUserId: OWNER_A,
        teamCode: "TEAM-A",
        createdAt: "seed",
        updatedAt: "seed",
      });

      await setDoc(doc(db, "teams", TEAM_B), {
        name: "Team B",
        ownerUserId: "owner-b",
        teamCode: "TEAM-B",
        createdAt: "seed",
        updatedAt: "seed",
      });

      await setDoc(doc(db, "users", OWNER_A), {
        email: "owner-a@example.test",
        displayName: "Owner A",
        role: "coach",
        currentTeamId: TEAM_A,
        activeTeamId: TEAM_A,
        createdAt: "seed",
        updatedAt: "seed",
      });

      await setDoc(doc(db, "users", ASSISTANT_A), {
        email: "assistant-a@example.test",
        displayName: "Assistant A",
        role: "coach",
        currentTeamId: TEAM_A,
        activeTeamId: TEAM_A,
        createdAt: "seed",
        updatedAt: "seed",
      });

      await setDoc(doc(db, "users", LEGACY_A), {
        email: "legacy-a@example.test",
        displayName: "Legacy A",
        role: "athlete",
        currentTeamId: TEAM_A,
        activeTeamId: TEAM_A,
        createdAt: "seed",
        updatedAt: "seed",
      });

      await setDoc(doc(db, "users", ATHLETE_A), {
        email: "athlete-a@example.test",
        displayName: "Athlete A",
        role: "athlete",
        currentTeamId: TEAM_A,
        activeTeamId: TEAM_A,
        createdAt: "seed",
        updatedAt: "seed",
      });

      await setDoc(doc(db, "users", PARENT_A), {
        email: "parent-a@example.test",
        displayName: "Parent A",
        role: "parent",
        currentTeamId: TEAM_A,
        activeTeamId: TEAM_A,
        linkedWrestlerIds: ["wrestler-a"],
        createdAt: "seed",
        updatedAt: "seed",
      });

      await setDoc(doc(db, "users", ATHLETE_B), {
        email: "athlete-b@example.test",
        displayName: "Athlete B",
        role: "athlete",
        currentTeamId: TEAM_B,
        activeTeamId: TEAM_B,
        createdAt: "seed",
        updatedAt: "seed",
      });

      await setDoc(doc(db, "users", SUSPENDED_A), {
        email: "suspended-a@example.test",
        displayName: "Suspended A",
        role: "athlete",
        currentTeamId: TEAM_A,
        activeTeamId: TEAM_A,
        createdAt: "seed",
        updatedAt: "seed",
      });

      await setDoc(
        doc(
          db,
          "team_members",
          `${TEAM_A}_${OWNER_A}`
        ),
        {
          teamId: TEAM_A,
          userId: OWNER_A,
          role: "coach",
          membershipRole: "owner",
          status: "active",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(
          db,
          "team_members",
          `${TEAM_A}_${ASSISTANT_A}`
        ),
        {
          teamId: TEAM_A,
          userId: ASSISTANT_A,
          role: "coach",
          membershipRole: "assistant_coach",
          status: "active",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(
          db,
          "team_members",
          `${TEAM_A}_${ATHLETE_A}`
        ),
        {
          teamId: TEAM_A,
          userId: ATHLETE_A,
          role: "athlete",
          membershipRole: "athlete",
          status: "active",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(
          db,
          "team_members",
          `${TEAM_A}_${PARENT_A}`
        ),
        {
          teamId: TEAM_A,
          userId: PARENT_A,
          role: "parent",
          membershipRole: "parent",
          status: "active",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(
          db,
          "team_members",
          `${TEAM_B}_${ATHLETE_B}`
        ),
        {
          teamId: TEAM_B,
          userId: ATHLETE_B,
          role: "athlete",
          membershipRole: "athlete",
          status: "active",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(
          db,
          "team_members",
          `${TEAM_A}_${SUSPENDED_A}`
        ),
        {
          teamId: TEAM_A,
          userId: SUSPENDED_A,
          role: "athlete",
          membershipRole: "athlete",
          status: "suspended",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "team_members", "legacy-random-id"),
        {
          teamId: TEAM_A,
          userId: LEGACY_A,
          role: "athlete",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "practice_plans", "plan-a"),
        {
          teamId: TEAM_A,
          title: "Team A Plan",
          createdBy: OWNER_A,
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "practice_plans", "plan-b"),
        {
          teamId: TEAM_B,
          title: "Team B Plan",
          createdBy: "owner-b",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "wrestlers", "wrestler-a"),
        {
          teamId: TEAM_A,
          ownerUserId: ATHLETE_A,
          firstName: "Test",
          lastName: "Athlete",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "wrestlers", "wrestler-b"),
        {
          teamId: TEAM_B,
          ownerUserId: ATHLETE_B,
          firstName: "Other",
          lastName: "Athlete",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "wrestlers", "wrestler-a-other"),
        {
          teamId: TEAM_A,
          ownerUserId: "other-athlete-a",
          firstName: "Other",
          lastName: "Team A Athlete",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "athlete_journal_entries", "journal-private-a"),
        {
          teamId: TEAM_A,
          wrestlerId: "wrestler-a",
          createdByUserId: ATHLETE_A,
          coachVisible: false,
          title: "Private entry",
          notes: "Private",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "athlete_journal_entries", "journal-shared-a"),
        {
          teamId: TEAM_A,
          wrestlerId: "wrestler-a",
          createdByUserId: ATHLETE_A,
          coachVisible: true,
          title: "Coach-visible entry",
          notes: "Shared",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "athlete_journal_entries", "journal-shared-b"),
        {
          teamId: TEAM_B,
          wrestlerId: "wrestler-b",
          createdByUserId: ATHLETE_B,
          coachVisible: true,
          title: "Other team entry",
          notes: "Other team",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "athlete_goals", "goal-private-a"),
        {
          teamId: TEAM_A,
          wrestlerId: "wrestler-a",
          createdByUserId: ATHLETE_A,
          coachVisible: false,
          title: "Private goal",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "athlete_goals", "goal-shared-a"),
        {
          teamId: TEAM_A,
          wrestlerId: "wrestler-a",
          createdByUserId: ATHLETE_A,
          coachVisible: true,
          title: "Coach-visible goal",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "device_push_registrations", "device-a"),
        {
          userId: ATHLETE_A,
          teamId: TEAM_A,
          platform: "ios",
          expoPushToken: "test-token-a",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "calendar_events", "event-a"),
        {
          teamId: TEAM_A,
          title: "Team A Practice",
          date: "2026-11-14",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "calendar_events", "event-b"),
        {
          teamId: TEAM_B,
          title: "Team B Practice",
          date: "2026-11-14",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "practice_attendance", "attendance-a"),
        {
          teamId: TEAM_A,
          wrestlerId: "wrestler-a",
          calendarEventId: "event-a",
          status: "present",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "practice_attendance", "attendance-b"),
        {
          teamId: TEAM_B,
          wrestlerId: "wrestler-b",
          calendarEventId: "event-b",
          status: "present",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "tournaments", "tournament-a"),
        {
          teamId: TEAM_A,
          name: "Team A Tournament",
          source: "manual",
          registrationUrl: "",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "tournaments", "tournament-b"),
        {
          teamId: TEAM_B,
          name: "Team B Tournament",
          source: "manual",
          registrationUrl: "",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "tournament_entries", "entry-a"),
        {
          teamId: TEAM_A,
          tournamentId: "tournament-a",
          wrestlerId: "wrestler-a",
          wrestlerName: "Test Athlete",
          style: "Folkstyle",
          weightClass: "126",
          status: "planned",
          notes: "",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "tournament_entries", "entry-b"),
        {
          teamId: TEAM_B,
          tournamentId: "tournament-b",
          wrestlerId: "wrestler-b",
          wrestlerName: "Other Athlete",
          style: "Folkstyle",
          weightClass: "132",
          status: "planned",
          notes: "",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "tournament_matches", "match-a"),
        {
          teamId: TEAM_A,
          tournamentId: "tournament-a",
          tournamentEntryId: "entry-a",
          wrestlerId: "wrestler-a",
          status: "upcoming",
          boutNumber: "",
          matNumber: "",
          roundName: "",
          opponentName: "",
          opponentTeam: "",
          result: "",
          score: "",
          method: "",
          notes: "",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "tournament_matches", "match-b"),
        {
          teamId: TEAM_B,
          tournamentId: "tournament-b",
          tournamentEntryId: "entry-b",
          wrestlerId: "wrestler-b",
          status: "upcoming",
          boutNumber: "",
          matNumber: "",
          roundName: "",
          opponentName: "",
          opponentTeam: "",
          result: "",
          score: "",
          method: "",
          notes: "",
          createdAt: "seed",
          updatedAt: "seed",
        }
      );

      await setDoc(
        doc(db, "private_unknown", "secret"),
        {
          value: "must remain private",
        }
      );
    }
  );
}

function authedDb(userId: string) {
  return testEnv
    .authenticatedContext(userId)
    .firestore();
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(
        "firestore.rules.membership-candidate",
        "utf8"
      ),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedData();
});

after(async () => {
  await testEnv.cleanup();
});

test(
  "anonymous user cannot read a team",
  async () => {
    const db = testEnv
      .unauthenticatedContext()
      .firestore();

    await assertFails(
      getDoc(doc(db, "teams", TEAM_A))
    );
  }
);

test(
  "authenticated user can read own team",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertSucceeds(
      getDoc(doc(db, "teams", TEAM_A))
    );
  }
);

test(
  "authenticated user cannot read another team",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      getDoc(doc(db, "teams", TEAM_B))
    );
  }
);

test(
  "athlete can read a practice plan for own team",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertSucceeds(
      getDoc(doc(db, "practice_plans", "plan-a"))
    );
  }
);

test(
  "athlete cannot read another team's practice plan",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      getDoc(doc(db, "practice_plans", "plan-b"))
    );
  }
);

test(
  "parent can read linked wrestler",
  async () => {
    const db = authedDb(PARENT_A);

    await assertSucceeds(
      getDoc(doc(db, "wrestlers", "wrestler-a"))
    );
  }
);

test(
  "parent cannot read unlinked wrestler",
  async () => {
    const db = authedDb(PARENT_A);

    await assertFails(
      getDoc(doc(db, "wrestlers", "wrestler-b"))
    );
  }
);

test(
  "athlete cannot edit team practice plan",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      updateDoc(
        doc(db, "practice_plans", "plan-a"),
        {
          title: "Unauthorized title",
        }
      )
    );
  }
);

test(
  "coach can edit own team's practice plan",
  async () => {
    const db = authedDb(OWNER_A);

    await assertSucceeds(
      updateDoc(
        doc(db, "practice_plans", "plan-a"),
        {
          title: "Updated Plan",
        }
      )
    );
  }
);

test(
  "suspended membership revokes team access",
  async () => {
    const db = authedDb(SUSPENDED_A);

    await assertFails(
      getDoc(doc(db, "practice_plans", "plan-a"))
    );
  }
);

test(
  "athlete cannot create own active team membership",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      setDoc(
        doc(
          db,
          "team_members",
          `${TEAM_B}_${ATHLETE_A}`
        ),
        {
          teamId: TEAM_B,
          userId: ATHLETE_A,
          role: "athlete",
          membershipRole: "athlete",
          status: "active",
          createdAt: "client",
          updatedAt: "client",
        }
      )
    );
  }
);

test(
  "ordinary team member cannot read another member's push token",
  async () => {
    const db = authedDb(PARENT_A);

    await assertFails(
      getDoc(
        doc(
          db,
          "device_push_registrations",
          "device-a"
        )
      )
    );
  }
);

test(
  "unknown collection is denied",
  async () => {
    const db = authedDb(OWNER_A);

    await assertFails(
      getDoc(
        doc(db, "private_unknown", "secret")
      )
    );
  }
);

test(
  "coach can query team membership records",
  async () => {
    const db = authedDb(OWNER_A);

    const membershipQuery = query(
      collection(db, "team_members"),
      where("teamId", "==", TEAM_A)
    );

    const result = await assertSucceeds(
      getDocs(membershipQuery)
    );

    assert.ok(result.size >= 1);
  }
);

test(
  "athlete cannot promote self to coach",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      updateDoc(doc(db, "users", ATHLETE_A), {
        role: "coach",
        updatedAt: "client",
      })
    );
  }
);

test(
  "athlete cannot select a team without active membership",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      updateDoc(doc(db, "users", ATHLETE_A), {
        activeTeamId: TEAM_B,
        updatedAt: "client",
      })
    );
  }
);

test(
  "athlete can keep selected team within active membership",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertSucceeds(
      updateDoc(doc(db, "users", ATHLETE_A), {
        activeTeamId: TEAM_A,
        displayName: "Athlete A Updated",
        updatedAt: "client",
      })
    );
  }
);

test(
  "owner can update safe team fields",
  async () => {
    const db = authedDb(OWNER_A);

    await assertSucceeds(
      updateDoc(doc(db, "teams", TEAM_A), {
        name: "Team A Updated",
        updatedAt: "client",
      })
    );
  }
);

test(
  "assistant coach cannot replace team owner",
  async () => {
    const db = authedDb(ASSISTANT_A);

    await assertFails(
      updateDoc(doc(db, "teams", TEAM_A), {
        ownerUserId: ASSISTANT_A,
        updatedAt: "client",
      })
    );
  }
);

test(
  "legacy random-ID membership alone grants no team access",
  async () => {
    const db = authedDb(LEGACY_A);

    await assertFails(
      getDoc(doc(db, "practice_plans", "plan-a"))
    );
  }
);

test(
  "athlete can read owned wrestler profile",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertSucceeds(
      getDoc(doc(db, "wrestlers", "wrestler-a"))
    );
  }
);

test(
  "athlete cannot read another wrestler on the same team",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      getDoc(
        doc(db, "wrestlers", "wrestler-a-other")
      )
    );
  }
);

test(
  "parent can read linked wrestler profile",
  async () => {
    const db = authedDb(PARENT_A);

    await assertSucceeds(
      getDoc(doc(db, "wrestlers", "wrestler-a"))
    );
  }
);

test(
  "parent cannot read unlinked same-team wrestler",
  async () => {
    const db = authedDb(PARENT_A);

    await assertFails(
      getDoc(
        doc(db, "wrestlers", "wrestler-a-other")
      )
    );
  }
);

test(
  "coach can read wrestler profile on own team",
  async () => {
    const db = authedDb(OWNER_A);

    await assertSucceeds(
      getDoc(
        doc(db, "wrestlers", "wrestler-a-other")
      )
    );
  }
);

test(
  "coach cannot read wrestler profile from another team",
  async () => {
    const db = authedDb(OWNER_A);

    await assertFails(
      getDoc(doc(db, "wrestlers", "wrestler-b"))
    );
  }
);

test(
  "athlete can read own private journal entry",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertSucceeds(
      getDoc(
        doc(
          db,
          "athlete_journal_entries",
          "journal-private-a"
        )
      )
    );
  }
);

test(
  "coach cannot read private athlete journal entry",
  async () => {
    const db = authedDb(OWNER_A);

    await assertFails(
      getDoc(
        doc(
          db,
          "athlete_journal_entries",
          "journal-private-a"
        )
      )
    );
  }
);

test(
  "coach can read coach-visible journal entry on own team",
  async () => {
    const db = authedDb(OWNER_A);

    await assertSucceeds(
      getDoc(
        doc(
          db,
          "athlete_journal_entries",
          "journal-shared-a"
        )
      )
    );
  }
);

test(
  "parent cannot read athlete journal entries",
  async () => {
    const db = authedDb(PARENT_A);

    await assertFails(
      getDoc(
        doc(
          db,
          "athlete_journal_entries",
          "journal-shared-a"
        )
      )
    );
  }
);

test(
  "coach cannot read coach-visible journal from another team",
  async () => {
    const db = authedDb(OWNER_A);

    await assertFails(
      getDoc(
        doc(
          db,
          "athlete_journal_entries",
          "journal-shared-b"
        )
      )
    );
  }
);

test(
  "athlete cannot move journal entry to another team",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      updateDoc(
        doc(
          db,
          "athlete_journal_entries",
          "journal-private-a"
        ),
        {
          teamId: TEAM_B,
          updatedAt: "client",
        }
      )
    );
  }
);

test(
  "athlete can read own private goal",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertSucceeds(
      getDoc(
        doc(
          db,
          "athlete_goals",
          "goal-private-a"
        )
      )
    );
  }
);

test(
  "coach cannot read private athlete goal",
  async () => {
    const db = authedDb(OWNER_A);

    await assertFails(
      getDoc(
        doc(
          db,
          "athlete_goals",
          "goal-private-a"
        )
      )
    );
  }
);

test(
  "coach can read coach-visible athlete goal on own team",
  async () => {
    const db = authedDb(OWNER_A);

    await assertSucceeds(
      getDoc(
        doc(
          db,
          "athlete_goals",
          "goal-shared-a"
        )
      )
    );
  }
);

test(
  "athlete cannot move goal to another team",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      updateDoc(
        doc(db, "athlete_goals", "goal-private-a"),
        {
          teamId: TEAM_B,
          updatedAt: "client",
        }
      )
    );
  }
);

test(
  "athlete can read own attendance record",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertSucceeds(
      getDoc(
        doc(
          db,
          "practice_attendance",
          "attendance-a"
        )
      )
    );
  }
);

test(
  "athlete cannot read another team's attendance",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      getDoc(
        doc(
          db,
          "practice_attendance",
          "attendance-b"
        )
      )
    );
  }
);

test(
  "parent can read linked wrestler attendance",
  async () => {
    const db = authedDb(PARENT_A);

    await assertSucceeds(
      getDoc(
        doc(
          db,
          "practice_attendance",
          "attendance-a"
        )
      )
    );
  }
);

test(
  "athlete can create own-team attendance",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertSucceeds(
      setDoc(
        doc(
          db,
          "practice_attendance",
          "attendance-athlete-created"
        ),
        {
          teamId: TEAM_A,
          wrestlerId: "wrestler-a",
          calendarEventId: "event-a",
          status: "present",
          createdAt: "client",
          updatedAt: "client",
        }
      )
    );
  }
);

test(
  "athlete cannot create attendance for another team",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      setDoc(
        doc(
          db,
          "practice_attendance",
          "attendance-cross-team"
        ),
        {
          teamId: TEAM_B,
          wrestlerId: "wrestler-b",
          calendarEventId: "event-b",
          status: "present",
          createdAt: "client",
          updatedAt: "client",
        }
      )
    );
  }
);

test(
  "parent can create attendance for linked wrestler",
  async () => {
    const db = authedDb(PARENT_A);

    await assertSucceeds(
      setDoc(
        doc(
          db,
          "practice_attendance",
          "attendance-parent-created"
        ),
        {
          teamId: TEAM_A,
          wrestlerId: "wrestler-a",
          calendarEventId: "event-a",
          status: "present",
          createdAt: "client",
          updatedAt: "client",
        }
      )
    );
  }
);

test(
  "parent cannot create attendance for unlinked wrestler",
  async () => {
    const db = authedDb(PARENT_A);

    await assertFails(
      setDoc(
        doc(
          db,
          "practice_attendance",
          "attendance-parent-unlinked"
        ),
        {
          teamId: TEAM_A,
          wrestlerId: "wrestler-a-other",
          calendarEventId: "event-a",
          status: "present",
          createdAt: "client",
          updatedAt: "client",
        }
      )
    );
  }
);

test(
  "coach can update own-team attendance",
  async () => {
    const db = authedDb(OWNER_A);

    await assertSucceeds(
      updateDoc(
        doc(
          db,
          "practice_attendance",
          "attendance-a"
        ),
        {
          status: "excused",
          updatedAt: "client",
        }
      )
    );
  }
);

test(
  "athlete can read own-team calendar event",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertSucceeds(
      getDoc(
        doc(db, "calendar_events", "event-a")
      )
    );
  }
);

test(
  "athlete cannot read another team's calendar event",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      getDoc(
        doc(db, "calendar_events", "event-b")
      )
    );
  }
);

test(
  "athlete can read own-team tournament",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertSucceeds(
      getDoc(
        doc(db, "tournaments", "tournament-a")
      )
    );
  }
);

test(
  "athlete cannot read another team's private tournament",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      getDoc(
        doc(db, "tournaments", "tournament-b")
      )
    );
  }
);

test(
  "athlete can read own tournament entry",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertSucceeds(
      getDoc(
        doc(db, "tournament_entries", "entry-a")
      )
    );
  }
);

test(
  "athlete cannot read another team's tournament entry",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      getDoc(
        doc(db, "tournament_entries", "entry-b")
      )
    );
  }
);

test(
  "athlete can submit own planned tournament entry",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertSucceeds(
      updateDoc(
        doc(db, "tournament_entries", "entry-a"),
        {
          status: "submitted",
          updatedAt: "client",
        }
      )
    );
  }
);

test(
  "parent can create tournament entry for linked wrestler",
  async () => {
    const db = authedDb(PARENT_A);

    await assertSucceeds(
      setDoc(
        doc(
          db,
          "tournament_entries",
          "entry-parent-created"
        ),
        {
          teamId: TEAM_A,
          tournamentId: "tournament-a",
          wrestlerId: "wrestler-a",
          wrestlerName: "Test Athlete",
          style: "Folkstyle",
          weightClass: "126",
          status: "planned",
          notes: "",
          createdAt: "client",
          updatedAt: "client",
        }
      )
    );
  }
);

test(
  "parent cannot create tournament entry for unlinked wrestler",
  async () => {
    const db = authedDb(PARENT_A);

    await assertFails(
      setDoc(
        doc(
          db,
          "tournament_entries",
          "entry-parent-unlinked"
        ),
        {
          teamId: TEAM_A,
          tournamentId: "tournament-a",
          wrestlerId: "wrestler-a-other",
          wrestlerName: "Other Team A Athlete",
          style: "Folkstyle",
          weightClass: "138",
          status: "planned",
          notes: "",
          createdAt: "client",
          updatedAt: "client",
        }
      )
    );
  }
);

test(
  "athlete can read own tournament match",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertSucceeds(
      getDoc(
        doc(db, "tournament_matches", "match-a")
      )
    );
  }
);

test(
  "athlete cannot read another team's tournament match",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      getDoc(
        doc(db, "tournament_matches", "match-b")
      )
    );
  }
);

test(
  "athlete can update allowed fields on own tournament match",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertSucceeds(
      updateDoc(
        doc(db, "tournament_matches", "match-a"),
        {
          boutNumber: "41",
          matNumber: "3",
          status: "onDeck",
          updatedAt: "client",
        }
      )
    );
  }
);

test(
  "athlete cannot move tournament match to another team",
  async () => {
    const db = authedDb(ATHLETE_A);

    await assertFails(
      updateDoc(
        doc(db, "tournament_matches", "match-a"),
        {
          teamId: TEAM_B,
          updatedAt: "client",
        }
      )
    );
  }
);
