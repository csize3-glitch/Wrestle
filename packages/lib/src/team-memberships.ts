/**
 * Returns the deterministic Firestore document ID for a team membership.
 *
 * One user can have one membership document per team.
 */
export function makeTeamMembershipId(
  teamId: string,
  userId: string
): string {
  const normalizedTeamId = teamId.trim();
  const normalizedUserId = userId.trim();

  if (!normalizedTeamId) {
    throw new Error("A team ID is required to create a membership ID.");
  }

  if (!normalizedUserId) {
    throw new Error("A user ID is required to create a membership ID.");
  }

  return `${normalizedTeamId}_${normalizedUserId}`;
}
