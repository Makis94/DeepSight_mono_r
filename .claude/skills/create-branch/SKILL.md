---
name: create-branch
description: Use this skill whenever the user asks to create a new git branch, in Russian or English (e.g. "создай ветку", "сделай ветку под...", "create a branch for...", "make a branch that handles..."). Branches are always cut from main and named <type>/DS-<number>-<slug>, where type is bug or feature inferred from what the user describes, number is the next sequential DS number across all branches, and slug is an English translation of the user's description regardless of what language they wrote the request in.
---

# Creating a git branch (DS-XXX convention)

## Naming convention (mandatory, no exceptions)

```
<type>/DS-<number>-<english-slug>
```

- **`<type>`** — `bug` or `feature`. Infer from what the user is describing:
  - fixing broken/incorrect/unexpected behavior → `bug`
  - adding or changing functionality → `feature`
  - If genuinely ambiguous from their description, ask instead of guessing.
- **`DS`** — literal, always uppercase, never varies.
- **`<number>`** — next sequential number, zero-padded to 3 digits (`001`, `002`, …). Always determined by checking existing branches (step 1 below) — never invented.
- **`<english-slug>`** — kebab-case **English** translation of the user's description of the problem/feature. The branch name is always in English even when the user wrote their request in Russian — translate the meaning, don't transliterate the Russian words. Keep it short (roughly 3–6 words) and descriptive of the actual change, not a restatement like "create-branch".

Example: user writes in Russian "создай ветку, добавляем фильтр по монетам" → `feature/DS-001-add-coin-filters`

## Steps

1. **Determine the next number.** Scan local + remote branch names for the `DS-<number>` pattern and take the max + 1:

   ```bash
   git fetch --quiet origin 2>/dev/null || true
   git branch -a --format='%(refname:short)' | grep -oE 'DS-[0-9]+' | grep -oE '[0-9]+' | sort -n | tail -1
   ```

   Zero-pad the result to 3 digits. If no `DS-*` branches exist yet, start at `001`.

2. **Update main from the remote** before branching off it (don't touch the user's current branch/working tree to do this):

   ```bash
   git fetch origin main --quiet
   ```

3. **Create the new branch from main**, without checking main itself out or altering it:

   ```bash
   git checkout -b <type>/DS-<number>-<slug> origin/main
   ```

   Fall back to local `main` if there is no reachable `origin`. If the current working tree has uncommitted changes, say so before switching — `checkout -b` carries them onto the new branch rather than discarding them, which is usually fine but the user should know it happened.

4. Report back the exact branch name created and confirm it's based on current main.

## Notes

- Never invent the `<number>` without checking existing branches first (step 1) — collisions or gaps are the main way this goes wrong.
- Never leave any part of the branch name in Russian or transliterated Russian — always a genuine English translation of the intent.
- Don't ask the user to spell out `bug` vs `feature` unless their description is truly ambiguous — infer it from context.
