/**
 * A mock user database for the example bot. In a real app, resolve users from
 * your own user store (the same ids you pass to Velt's `setDocuments`/identity).
 */

export const BOT_USER_ID = "velt-bot";
export const BOT_USER_NAME = "Velt Bot";

interface UserRecord {
  userId: string;
  name: string;
  email?: string;
  photoUrl?: string;
}

const USERS: UserRecord[] = [
  { userId: "user-1", name: "Charlie Layne", email: "charlie@example.com" },
  { userId: "user-2", name: "Mislav Abha", email: "mislav@example.com" },
  { userId: BOT_USER_ID, name: BOT_USER_NAME },
];

// Names learned from incoming comments at runtime, so mentions of real users
// (whom this mock DB doesn't know up front) still render with their display name.
const seenUsers = new Map<string, UserRecord>();

/** Record a user seen on an incoming comment, so we can resolve them later. */
export function rememberUser(userId?: string, name?: string, email?: string): void {
  if (userId && name) seenUsers.set(userId, { userId, name, email });
}

export function getUser(userId: string): { name: string; avatarUrl?: string; email?: string } | null {
  const user = USERS.find((u) => u.userId === userId) ?? seenUsers.get(userId);
  if (!user) return null;
  return { name: user.name, avatarUrl: user.photoUrl, email: user.email };
}

/** Resolve Velt user ids into display info for mentions/authors. */
export function resolveUsers({ userIds }: { userIds: string[] }) {
  return userIds.map((id) => getUser(id) ?? undefined);
}
