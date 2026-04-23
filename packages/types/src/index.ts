export type WrestlingStyle = "Freestyle" | "Folkstyle" | "Greco-Roman";
export type UserRole = "coach" | "athlete";

export interface LibraryItem {
  id: string;
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
  source: "excel_import" | "manual";
  createdAt: string;
  updatedAt: string;
}

export interface PracticePlan {
  id: string;
  title: string;
  teamId: string;
  style: WrestlingStyle | "Mixed";
  level?: string;
  description?: string;
  totalMinutes: number;
  totalSeconds?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PracticeBlock {
  id: string;
  practicePlanId: string;
  orderIndex: number;
  libraryItemId: string;
  titleOverride?: string;
  durationMinutes: number;
  durationSeconds?: number;
  coachingNotes?: string;
  emphasis?: string;
}

export interface CalendarEvent {
  id: string;
  teamId: string;
  practicePlanId: string;
  date: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  totalSeconds?: number;
}

export interface WrestlerProfile {
  id: string;
  teamId: string;
  ownerUserId?: string;
  firstName: string;
  lastName: string;
  photoUrl?: string;
  age?: number;
  grade?: string;
  weightClass?: string;
  schoolOrClub?: string;
  styles: WrestlingStyle[];
  strengths: string[];
  weaknesses: string[];
  warmupRoutine: string[];
  keyAttacks: string[];
  keyDefense: string[];
  goals: string[];
  coachNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MatSideSummary {
  wrestlerId: string;
  quickReminders: string[];
  warmupChecklist: string[];
  strengths: string[];
  weaknesses: string[];
  gamePlan: string[];
  recentNotes: string[];
  updatedAt: string;
}

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  currentTeamId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Team {
  id: string;
  name: string;
  teamCode: string;
  coachInviteCode?: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMemberRecord extends TeamMember {
  displayName: string;
  email: string;
  currentTeamId?: string;
  isOwner: boolean;
}

export interface Tournament {
  id: string;
  teamId: string;
  name: string;
  registrationUrl: string;
  eventDate?: string;
  notes?: string;
  source: "excel_import" | "manual";
  createdAt: string;
  updatedAt: string;
}

export interface TournamentEntry {
  id: string;
  teamId: string;
  tournamentId: string;
  wrestlerId: string;
  wrestlerName: string;
  style?: WrestlingStyle;
  weightClass?: string;
  status: "planned" | "submitted" | "confirmed";
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamAnnouncement {
  id: string;
  teamId: string;
  title: string;
  body: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamNotification {
  id: string;
  teamId: string;
  audienceRole?: UserRole;
  title: string;
  body: string;
  type: "tournament_registration" | "system";
  createdBy: string;
  tournamentId?: string;
  tournamentEntryId?: string;
  wrestlerId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DevicePushRegistration {
  id: string;
  userId: string;
  teamId: string;
  platform: string;
  expoPushToken?: string;
  devicePushToken?: string;
  deviceName?: string;
  permissionsStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export const COLLECTIONS = {
  LIBRARY_ITEMS: "library_items",
  PRACTICE_PLANS: "practice_plans",
  PRACTICE_BLOCKS: "practice_blocks",
  CALENDAR_EVENTS: "calendar_events",
  WRESTLERS: "wrestlers",
  MAT_SIDE_SUMMARIES: "mat_side_summaries",
  TEAMS: "teams",
  USERS: "users",
  TEAM_MEMBERS: "team_members",
  TOURNAMENTS: "tournaments",
  TOURNAMENT_ENTRIES: "tournament_entries",
  TEAM_ANNOUNCEMENTS: "team_announcements",
  TEAM_NOTIFICATIONS: "team_notifications",
  DEVICE_PUSH_REGISTRATIONS: "device_push_registrations",
} as const;
