import type { AdminUserRow } from "@hypertracker/shared/schemas/admin";
import { adminLogout } from "../lib/api.js";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Trial and active both read as "paid access currently works" — the distinct pill colors
// live in theme.css's .status-* classes, keyed directly off subscriptionStatus.
function expiryFor(row: AdminUserRow): string {
  if (row.subscriptionStatus === "trial") return formatDate(row.trialEndsAt);
  if (row.subscriptionStatus === "active") return formatDate(row.currentPeriodEnd);
  return "—";
}

export function UsersTable({
  users,
  onSignedOut,
}: {
  users: AdminUserRow[];
  onSignedOut: () => void;
}) {
  const handleLogout = async () => {
    await adminLogout();
    onSignedOut();
  };

  return (
    <div className="admin-shell">
      <div className="admin-header">
        <h1>Users ({users.length})</h1>
        <button className="secondary" onClick={() => void handleLogout()}>
          Sign out
        </button>
      </div>
      <div className="admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Telegram ID</th>
              <th>Username</th>
              <th>Name</th>
              <th>Joined</th>
              <th>Subscription</th>
              <th>Expires</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.telegramId}>
                <td>{user.telegramId}</td>
                <td>{user.username ? `@${user.username}` : "—"}</td>
                <td>{user.firstName ?? "—"}</td>
                <td>{formatDate(user.createdAt)}</td>
                <td>
                  <span className={`status-pill status-${user.subscriptionStatus}`}>
                    {user.subscriptionStatus}
                  </span>
                </td>
                <td>{expiryFor(user)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
