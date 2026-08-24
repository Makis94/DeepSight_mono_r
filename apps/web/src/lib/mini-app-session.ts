// Mini App auth token, held in memory only — deliberately never written to localStorage or
// sessionStorage. Two reasons: (1) Telegram's Mini App WebView/iframe embedding makes cookie
// persistence unreliable across platforms, so the standalone site's httpOnly-cookie approach
// (see apps/api's auth/routes.ts) isn't usable here, and Web Storage would just reintroduce
// the same JS-readable-token exposure that approach exists to avoid; (2) it's unnecessary —
// useMiniAppAuth already re-authenticates silently from Telegram's initData on every fresh
// mount when there's no token, so losing this on a reload/reopen is invisible to the user,
// not a regression.
let miniAppToken: string | null = null;

export function setMiniAppToken(token: string | null): void {
  miniAppToken = token;
}

export function getMiniAppToken(): string | null {
  return miniAppToken;
}
