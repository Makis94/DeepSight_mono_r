import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Deliberately a different port from apps/web (5173) — the two are separate origins by
    // design (see ADMIN_ORIGIN in apps/api/src/env.ts), not just different routes of one app.
    port: 5174,
  },
});
