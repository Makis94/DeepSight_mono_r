import type { AdminUserRow } from "@hypertracker/shared/schemas/admin";
import { useCallback, useEffect, useState } from "react";
import { AdminAuthError, fetchAdminUsers } from "./lib/api.js";
import { Login } from "./pages/Login.js";
import { UsersTable } from "./pages/UsersTable.js";

type View =
  | { status: "loading" }
  | { status: "login" }
  | { status: "ready"; users: AdminUserRow[] }
  | { status: "error"; message: string };

export function App() {
  const [view, setView] = useState<View>({ status: "loading" });

  const loadUsers = useCallback(async () => {
    setView({ status: "loading" });
    try {
      const users = await fetchAdminUsers();
      setView({ status: "ready", users });
    } catch (err) {
      if (err instanceof AdminAuthError) {
        setView({ status: "login" });
        return;
      }
      setView({ status: "error", message: err instanceof Error ? err.message : "load failed" });
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  if (view.status === "loading") {
    return <p className="admin-shell">Loading…</p>;
  }
  if (view.status === "login") {
    return <Login onSuccess={() => void loadUsers()} />;
  }
  if (view.status === "error") {
    return (
      <div className="admin-shell">
        <p className="admin-error">{view.message}</p>
        <button onClick={() => void loadUsers()}>Retry</button>
      </div>
    );
  }
  return <UsersTable users={view.users} onSignedOut={() => setView({ status: "login" })} />;
}
