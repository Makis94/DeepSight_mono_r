import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Free ngrok subdomains are random and rotate on every restart (see scripts/dev.sh
    // notes on local Telegram auth testing) — allow the whole ngrok-free.app domain
    // rather than hardcoding today's subdomain.
    allowedHosts: [".ngrok-free.app"],
    // Dev-only: proxy API calls through this same origin instead of hitting apps/api
    // cross-origin. Only matters when testing through an ngrok tunnel (VITE_API_URL set to
    // this same tunnel's URL, see apps/web/.env) — same-origin means no CORS preflight at
    // all, which sidesteps an unresolved issue where ngrok's free-tier edge appears to
    // never forward the actual (non-preflight) request for some PATCH calls even though the
    // preflight itself succeeds. `server.proxy` is a vite-dev-server-only feature; it has no
    // effect on `vite build` output, so this doesn't touch the production path.
    proxy: {
      "/auth": "http://localhost:3001",
      "/settings": "http://localhost:3001",
      "/watched-wallets": "http://localhost:3001",
      "/coins": "http://localhost:3001",
      "/prices": "http://localhost:3001",
      "/events": "http://localhost:3001",
      "/subscription": "http://localhost:3001",
      "/realtime": { target: "http://localhost:3001", ws: true },
    },
  },
});
