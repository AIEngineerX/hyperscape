# Assets Directory Investigation & Fix Plan

## Problem

Files from `packages/server/world/assets/manifests/` are being tracked in the main `HyperscapeAI/hyperscape` repo. They should only live in `HyperscapeAI/assets` and be pulled in at install time.

## Current State

### How it works today

1. `packages/server/world/assets/` is a **standalone nested git repo** (cloned from `HyperscapeAI/assets`). It is NOT a registered git submodule — there is no `.gitmodules` file.
2. `bun install` triggers `scripts/ensure-assets.mjs` (postinstall hook) which shallow-clones the assets repo into that directory + runs `git lfs pull`.
3. `bun run assets:sync` runs `cd packages/server/world/assets && git pull origin main`.
4. You can `cd packages/server/world/assets` and push changes to the assets remote.
5. Binary assets (models, textures, audio, etc.) are properly gitignored from the main repo.

### What's broken

**40 manifest JSON files** are tracked directly in the main Hyperscape repo. This was done intentionally in commits `aa1ea2dd6` and `2dddf28e4` (Feb 21–22, 2026) to fix CI failures — CI had no access to the assets repo and needed manifests for server startup and testing.

The root `.gitignore` was configured to allow this:

```gitignore
packages/server/world/assets/*
!packages/server/world/assets/manifests/
```

### Consequences

- Manifest edits have been happening in the main repo (not the assets repo).
- The two repos have **diverged significantly** — the main repo's manifests are newer and different from the assets repo's copies.
- The git status regularly shows modified manifest files as part of main repo changes.
- A previous submodule attempt (commit `c7b59b23c` on `origin/jeju` branch) was never merged and used the wrong path (`assets` instead of `packages/server/world/assets`).

### Files tracked in main repo (should not be)

```
packages/server/world/assets/manifests/README.md
packages/server/world/assets/manifests/ammunition.json
packages/server/world/assets/manifests/biomes.json
packages/server/world/assets/manifests/buildings.json
packages/server/world/assets/manifests/combat-spells.json
packages/server/world/assets/manifests/duel-arenas.json
packages/server/world/assets/manifests/gathering/fishing.json
packages/server/world/assets/manifests/gathering/mining.json
packages/server/world/assets/manifests/gathering/woodcutting.json
packages/server/world/assets/manifests/items/ammunition.json
packages/server/world/assets/manifests/items/armor.json
packages/server/world/assets/manifests/items/food.json
packages/server/world/assets/manifests/items/misc.json
packages/server/world/assets/manifests/items/resources.json
packages/server/world/assets/manifests/items/runes.json
packages/server/world/assets/manifests/items/tools.json
packages/server/world/assets/manifests/items/weapons.json
packages/server/world/assets/manifests/lod-settings.json
packages/server/world/assets/manifests/model-bounds.json
packages/server/world/assets/manifests/music.json
packages/server/world/assets/manifests/npcs.json
packages/server/world/assets/manifests/prayers.json
packages/server/world/assets/manifests/quests.json
packages/server/world/assets/manifests/recipes/cooking.json
packages/server/world/assets/manifests/recipes/crafting.json
packages/server/world/assets/manifests/recipes/firemaking.json
packages/server/world/assets/manifests/recipes/fletching.json
packages/server/world/assets/manifests/recipes/runecrafting.json
packages/server/world/assets/manifests/recipes/smelting.json
packages/server/world/assets/manifests/recipes/smithing.json
packages/server/world/assets/manifests/shops.json
packages/server/world/assets/manifests/spell-manifest.json
packages/server/world/assets/manifests/stations.json
packages/server/world/assets/manifests/towns.json
packages/server/world/assets/manifests/world-map.json
```

(40 files total)

### Relevant scripts

| Script | Location | Purpose |
|--------|----------|---------|
| `postinstall` | root `package.json` | Runs `scripts/ensure-assets.mjs` — clones assets repo on `bun install` |
| `assets:sync` | root `package.json` | `cd packages/server/world/assets && git pull origin main` |
| `assets:sync` | server `package.json` | `bun scripts/sync-assets-smart.mjs from-git` |
| `assets:deploy` | server `package.json` | `bun scripts/sync-assets-smart.mjs to-r2` |
| `assets:verify` | server `package.json` | `bun scripts/sync-assets-smart.mjs verify` |

---

## Proposed Solutions

### Prerequisite (required for all options)

**Sync manifests back to assets repo first.** The main repo's manifests are newer. Before any fix, copy them into the nested assets repo and push:

```bash
cd packages/server/world/assets
git add manifests/
git commit -m "sync: update manifests from main hyperscape repo"
git push origin main
```

---

### Option A — Proper Git Submodule

Convert `packages/server/world/assets` to a registered git submodule.

**Steps:**
1. Sync manifests to assets repo (prerequisite above)
2. Remove the nested repo directory: `rm -rf packages/server/world/assets`
3. Untrack the 40 manifest files: `git rm -r --cached packages/server/world/assets/manifests`
4. Add as submodule: `git submodule add https://github.com/HyperscapeAI/assets.git packages/server/world/assets`
5. Create `.gitmodules` (done automatically by the command above)
6. Update `.gitignore` to ignore the entire directory (submodule handles tracking)
7. Update CI workflows to run `git submodule update --init --recursive`
8. Update `ensure-assets.mjs` to use `git submodule update` instead of clone

**Pros:**
- Standard git mechanism for nested repos
- Git tracks the exact commit pinned in the parent repo
- `git clone --recurse-submodules` works out of the box

**Cons:**
- CI needs access to the assets repo (deploy key or token)
- Submodules add friction to the dev workflow (extra commands to update)
- Submodule pinning can cause stale assets if not updated regularly

---

### Option B — Keep Nested Repo, Stop Tracking Manifests

Keep the current clone-based approach but stop tracking manifests in the main repo.

**Steps:**
1. Sync manifests to assets repo (prerequisite above)
2. Untrack the 40 manifest files: `git rm -r --cached packages/server/world/assets/manifests`
3. Update `.gitignore` to ignore everything under assets:
   ```gitignore
   packages/server/world/assets/
   ```
4. Update `ensure-assets.mjs` to always run in CI (remove the CI skip logic)
5. CI needs a GitHub token or deploy key to clone the assets repo
6. Alternatively: CI downloads manifests from R2 instead of git

**Pros:**
- Minimal change to current workflow
- No submodule complexity
- Developers keep using `cd assets && git push`

**Cons:**
- CI must have access to clone or download assets
- No pinned commit — always pulls latest from assets `main`
- Nested repo is invisible to git (easy to forget it exists)

---

### Option C — Hybrid: Track Manifests via CI Sync Bot

Keep manifests tracked in the main repo but automate syncing from the assets repo.

**Steps:**
1. Keep current `.gitignore` setup (manifests tracked, binaries ignored)
2. Add a GitHub Action on `HyperscapeAI/assets` that, on push to `main`:
   - Opens a PR on `HyperscapeAI/hyperscape` updating the manifest files
3. Add a GitHub Action on `HyperscapeAI/hyperscape` that, on manifest changes:
   - Opens a PR on `HyperscapeAI/assets` syncing manifests back

**Pros:**
- CI always has manifests without needing assets repo access
- No submodule complexity
- Bidirectional sync prevents divergence

**Cons:**
- More CI infrastructure to maintain
- PRs add latency to manifest updates
- Still duplicating data across two repos

---

## Recommendation

**Option B** is the simplest path forward. The current nested-repo approach works well for developers. The main fix is just to stop tracking manifests in the main repo and ensure CI can pull them. If CI access is a blocker, Option A (submodule) provides a cleaner git-native solution at the cost of slightly more workflow friction.
