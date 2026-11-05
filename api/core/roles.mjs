// Role tiers (v3.1 rename): the PUBLIC vocabulary is member / admin / owner,
// but users.role stores the PRE-RENAME values — 'moderator' is the admin tier
// and 'admin' is the owner tier. D1 cannot alter a CHECK constraint short of
// rebuilding every table that references users, so the stored vocabulary is
// FROZEN (ROLE_*_DB below) and publicRole() is the single map every role
// value passes through on its way out of SQL. All JS comparisons use the
// public values; only SQL literals and role WRITES use the stored constants.
// WARNING: publicRole is NOT idempotent — publicRole('admin') === 'owner' —
// so only ever feed it raw DB values.
export const ROLE_OWNER_DB = "admin";
export const ROLE_ADMIN_DB = "moderator";
export const ROLE_MEMBER_DB = "member";
const PUBLIC_ROLE_BY_STORED = { member: "member", moderator: "admin", admin: "owner" };
export function publicRole(value) {
  return PUBLIC_ROLE_BY_STORED[value] || value;
}
