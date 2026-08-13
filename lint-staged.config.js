module.exports = {
  // ESLint's flat config resolves relative to the process cwd, so linting must
  // happen from inside each package directory — see scripts/lint-staged-eslint.mjs.
  "*.{ts,tsx,js,jsx}": (files) => `node scripts/lint-staged-eslint.mjs ${files.join(" ")}`,
  "*.{ts,tsx,js,jsx,json,md,yml,yaml}": "prettier --write",
};
