import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Deliberately a different port from apps/web (5173) — the two are separate origins by
    // design (see ADMIN_ORIGIN in apps/api/src/env.ts), not just different routes of one app.
    port: 5174,
    // Dev-only: proxy admin API calls through this same origin instead of hitting apps/api
    // cross-origin. The admin session cookie is sameSite: "strict" (see guard.ts/routes.ts),
    // which browsers never attach to a cross-origin fetch even with credentials: "include" —
    // same-origin via this proxy is what makes the cookie round-trip work locally. Requires
    // VITE_API_URL to point at this dev server's own origin (see apps/admin/.env.example),
    // not directly at localhost:3001. `server.proxy` is vite-dev-server-only; it has no
    // effect on `vite build` output.
    proxy: {
      "/admin": "http://localhost:3001",
    },
  },
});
