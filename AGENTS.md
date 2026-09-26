# AGENTS.md

Web-first slide tool for church worship teams: build song decks and presentations (sets), project them fullscreen over looping video backgrounds, and share decks through a public library. The UI is Korean. Desktop Chrome, Edge, Whale, Safari 16.4+ and Firefox are supported; a non-blocking banner appears only when a capability projection needs (fullscreen, H.264 playback, offline) is missing.

- Product scope: `docs/prd.md`, `docs/TECH_SPEC.md`
- Milestone task specs and current status: `docs/tasks/` (has its own `AGENTS.md`)
- Ops runbooks (deploy, backgrounds, moderation): `docs/ops/`

## Stack

One Cloudflare Worker serves the Vite SPA and the Hono API (`/api/*`), bound to one D1 database (`DB`) and one R2 bucket (`MEDIA_BUCKET`). The repo is a single pnpm package with no workspaces.

- **Client**: React 19, React Router 7 in library mode (not Next.js or TanStack Start), TanStack Query, Tailwind CSS 4 (`@tailwindcss/vite`), shadcn/ui (`base-nova` style on Base UI, not Radix) with `lucide-react` icons and `sonner` toasts
- **API**: Hono with `@hono/zod-validator`. The client talks to it only through `hc<AppType>` (`src/client/lib/api/client.ts`)
- **Data**: D1 + Drizzle ORM (FTS5 trigram search), R2 for background MP4s and posters
- **Auth**: Better Auth with Kakao/Naver (when configured), allowlisted email/password, and a localhost-only dev login
- **Offline**: `vite-plugin-pwa` (Workbox `generateSW`), `idb`
- **UI libs**: `react-moveable` (text box), `@dnd-kit/core` (drag and drop), `tinykeys` (shortcuts), fonts bundled from npm (`pretendard`, `@fontsource/*`), never from a CDN
- **Tooling**: Zod 3, Vite 8, Vitest 3 + `@cloudflare/vitest-pool-workers`

## Layout

```
src/client/   React SPA: routes/, features/<area>/, components/{ui,common,layout,stage}/, lib/{api,auth,browser,storage,sync,offline}, public/ (static assets, Vite `publicDir`)
src/worker/   Hono API: index.ts (createApp, AppType), routes/, middleware/, lib/{auth,password}.ts
src/shared/   "#shared": Zod schemas, constants, pure utils (runs in the browser and in workerd)
src/db/       "#db": Drizzle schema, queries/ (all DB access), ops/ (runbook SQL), migrations/ (drizzle-kit SQL plus hand-written FTS5 SQL). Worker-only
config/       drizzle.config.ts (passed to drizzle-kit by path), dev.vars.example, repo-level config tests
```

- Cross-layer imports use the `package.json` subpath imports `#shared` and `#db`. There are no path aliases.
- `#components/*`, `#lib/*` and `#hooks/*` map into `src/client` for the shadcn CLI (`components.json`). Generated primitives live in `src/client/components/ui/`.
- A config file stays at the root only if a tool finds it there by name (`components.json` is one). Tailwind has no config file: tokens live in `src/client/index.css`. Don't add `postcss.config.js`, `tailwind.config.*` or a `vitest.config.ts`; the Vitest projects live in `vite.config.ts` (`createTestConfig`, used only when `VITEST` is set).
- Older docs (especially `docs/tasks/**`) use the pre-2026-09-24 paths: `apps/web/src` → `src/client`, `apps/web/worker` → `src/worker`, `packages/shared/src` / `@repo/shared` → `src/shared` / `#shared`, `packages/db/src` / `@repo/db` → `src/db` / `#db`, `packages/db/drizzle` → `src/db/migrations`, and the repo-root `migrations/`, `tests/`, `public/` → `src/db/migrations/`, `config/`, `src/client/public/`.

### Layer boundaries (ESLint-enforced)

| Layer        | May import                                  |
| ------------ | ------------------------------------------- |
| `src/shared` | `zod`, `nanoid`, `es-hangul`, its own files |
| `src/db`     | `#shared`, `drizzle-orm`                    |
| `src/worker` | `#shared`, `#db`                            |
| `src/client` | `#shared`, `import type` from `src/worker`  |

- Projection files (`routes/FullscreenPresentRoute.tsx`, `features/presentation/**`, `components/stage/**`) must not import `@tanstack/react-query` or `lib/api`.
- Routes other than the projection, landing and share-join routes are `React.lazy` chunks (`routes/lazyRoutes.ts`). Modules in the main chunk (`App.tsx`, the projection route, stores) import feature files directly, not a feature barrel (`features/editor`, `features/drive`): Rolldown treats everything behind a barrel as reachable and pulls the editor and drive chunks (react-moveable, @dnd-kit) back into the first load. The noonnu font catalog loads through `loadNoonnuFontCatalog()`.
- `vite.config.ts` imports `src/shared/constants/projection.ts` by relative path, so that file must stay import-free.

## Commands

Use pnpm 12.6.0 (pinned in `packageManager`). CI runs Node 22. Run everything from the repo root. `wrangler` is a devDependency, so call it as `pnpm exec wrangler`.

```bash
pnpm install
cp config/dev.vars.example .dev.vars   # local secrets; DEV_LOGIN_ENABLED=true turns on dev login
pnpm db:migrate:local              # apply migrations to the local D1
pnpm dev                           # http://localhost:5173 (Vite + workerd, local bindings)

pnpm typecheck && pnpm lint && pnpm test    # the CI gate
pnpm build                         # dist/ (SPA + Worker); CI then runs `pnpm exec wrangler deploy --dry-run`
pnpm format:check                  # Prettier (`pnpm format` to fix)
pnpm db:generate                   # after editing src/db/schema/*
pnpm types                         # after editing wrangler.jsonc; needs .dev.vars or the secrets drop out of Env
pnpm fonts:previews                # after editing noonnuFontCatalog.ts; renders missing font-list previews with local Chrome (Node 23.6+)
```

- **Local login**: with `DEV_LOGIN_ENABLED=true`, the login page offers a dev login (`POST /api/dev-login`, default `dev@worship.local`). It works only when the host is localhost.
- **Remote bindings**: `CF_REMOTE_BINDINGS=true pnpm dev` attaches the real Cloudflare resources and needs `CLOUDFLARE_API_TOKEN`. The default is local.
- The service worker is disabled in `pnpm dev`, so PWA and offline behavior only show up in a production build.

## Testing

`vite.config.ts` defines three Vitest projects:

| Project  | Files                                     | Runtime                                                            |
| -------- | ----------------------------------------- | ------------------------------------------------------------------ |
| `worker` | `src/worker/**/*.test.ts`                 | workerd, with D1 built from the real migrations                    |
| `client` | `src/client/**/*.test.{ts,tsx}`           | jsdom                                                              |
| `node`   | `src/shared/**`, `src/db/**`, `config/**` | Node; `src/db` tests use an in-memory SQLite from `createTestDb()` |

```bash
pnpm vitest run --project worker
pnpm vitest run src/shared/utils/lyrics.test.ts
pnpm vitest run -t "slide split"
```

- Worker tests share one D1 (`singleWorker`, `isolatedStorage: false`). Reset the tables you use, and don't rely on test order. To inject a session, build the app with `createApp({ readSession })`.
- better-sqlite3 doesn't enforce foreign keys, so test FK and cascade behavior in the `worker` project.
- Some tests guard files outside their own folder and fail when you touch them:
  - `config/config.test.ts`: `package.json` scripts and imports, `wrangler.jsonc`
  - `config/pwaConfig.test.ts`: the PWA config
  - `src/db/migrations.test.ts`: no `backgrounds` rows in migrations
  - `src/db/ops/runbook.test.ts`: the SQL in `docs/ops/*.md` must match `src/db/ops/*Sql.ts` exactly, so edit both together
  - `src/client/routes/zeroFetch.test.tsx`: zero requests during projection
- When you change these rules, update their tests:
  - **Lyric split** (`src/shared/utils/lyrics.test.ts`): lines are trimmed (including full-width and non-breaking spaces), blank lines separate blocks, a block of 4 lines or fewer stays one slide, and longer blocks split into 2-line slides.
  - **Numeric jump** (`src/client/features/presentation/navigationBuffer.test.ts`): `N` + Enter jumps to slide N counted across the whole presentation (1..total). `0` and numbers above the total go to `onInvalidJump`. The buffer clears after 3 s, and backspace edits it.
  - **Search** (`src/db/queries/search.test.ts`): the query is split into tokens. Tokens of 3+ characters use FTS5 `MATCH`, shorter ones use `LIKE '%…%'`, and all are AND-ed.

## Guardrails

### Data and API

- Declare each domain model and API contract once, as a Zod schema in `src/shared/schemas/`, and derive types with `z.infer`. Parse the JSON TEXT columns (`decks.slides`, `decks.style`) with their schemas on read.
- Entity ids are 21-char NanoIDs from `createId()`, validated by `IdSchema`. `crypto.randomUUID()` is banned by lint. Slide ids come from `createSlideId()`.
- Write queries and test fixtures with the Drizzle query builder (`createD1Client(env.DB)` in worker tests, `createTestDb().db` in node tests, `clearTables` from `src/worker/test/db.ts` for resets). Raw `sql` fragments are only for what Drizzle lacks: the FTS5 `MATCH` operator, column arithmetic (`fork_count + 1`) and schema defaults. Only migrations and the runbook statements in `src/db/ops/` stay plain SQL.
- D1 has no row-level security. All DB access goes through helpers in `src/db/queries/`. Every private query or mutation filters by the session's `user_id`, and every public-library query includes `visibility = 'public'`.
- The library is a board: many users may publish the same song, and the copies are never merged. Sort by `fork_count DESC, updated_at DESC`.

### D1 migrations

- All history is squashed into `src/db/migrations/0001_initial.sql` (journal `idx: 1`), so the next `pnpm db:generate` writes `0002_*`. A D1 that applied older files must be recreated. Locally, delete `.wrangler/state/v3/d1` and run `pnpm db:migrate:local`.
- The FTS5 table `decks_fts` and its triggers are hand-written SQL. Delete any `*_fts` DDL that drizzle-kit generates.
- Never drop or recreate a parent table (`decks`, `presentations`, ...). D1 ignores `PRAGMA foreign_keys=OFF` in migrations, so the drop cascades deletes into child rows. Use `ALTER TABLE ... ADD COLUMN`, and write `ON DELETE SET NULL` by hand because drizzle-kit drops it.
- CI applies migrations before the deploy, so the previous release briefly runs on the new schema. Keep changes additive, and drop or rename a column only after the code stops using it.
- Never insert `backgrounds` rows in a migration: a row without its R2 objects renders as a broken background. Backgrounds are added by admins in the app (`POST /api/backgrounds/uploads`, gated by the `ADMIN_USER_IDS` secret) or with `docs/ops/background-runbook.md`. Users can't upload backgrounds; every background is a shared `source='service'` row shown in one gallery.

### Projection and offline

- The stage is DOM, not canvas or Reveal.js: a fixed 16:9 stage scaled with CSS `transform: scale()`, with three layers:
  1. A looping `<video>` that keeps playing across the slides of one song. The next song's video is preloaded.
  2. A black overlay with 0–100% opacity.
  3. The text box, positioned in percentages of the stage.
- Projection is fullscreen only (`/present/:presentationId/fullscreen`), driven from the same window.
- During projection the app makes zero data requests. The only network traffic allowed is `<video>` playback and background caching of same-origin media under `/api/media/`.
- While a set is open in the editor or on screen, `useBackgroundAutoCache` caches its backgrounds silently, with no progress UI, badge or download gate. The media route caches only full `200` responses.
- Browser-dependent APIs (fullscreen, clipboard, capability checks) go through `src/client/lib/browser/`. Detect features, never browser brands: fullscreen picks a strategy (`standard`, `webkit`, `unsupported`) per call, and clipboard falls back to `execCommand("copy")` outside secure contexts.
- The PWA uses `registerType: "prompt"`. Never auto-reload: a reload in the middle of a service stops the projection.
- These features were removed by product decision. Don't bring them back without a new decision:
  - Presenter view and the `BroadcastChannel` control window
  - The worship-prep download screen (`/present/:id/ready`)
  - LLM lyric normalization, the `AI` binding, and the lyrics catalog tables
  - The `N.M` (song.slide) jump syntax

### Auth

- Email/password login turns on only when the `EMAIL_SIGNUP_ALLOWLIST` secret is set (empty means off). Sign-up goes only through `POST /api/email-signup`, and Better Auth's `/sign-up/email` stays in `disabledPaths`.
- Passwords are hashed with PBKDF2-SHA256 at 100k iterations (`src/worker/lib/password.ts`). Better Auth's default scrypt goes over the Workers Free 10 ms CPU limit (error 1102), so don't switch back while on the Free plan.
- Password users stay `emailVerified=false`, so a later Kakao or Naver login with the same email is not linked to them automatically.
- Never set `DEV_LOGIN_ENABLED` in production secrets.

## Code style

- TypeScript strict. Exported functions and endpoints get explicit return types. Use `const` by default, and async/await.
- Naming:
  - Components: `PascalCase.tsx`
  - Hooks and utils: `camelCase.ts`
  - DB schema: `src/db/schema/<table>.ts`
  - Zod schemas: grouped by domain in `src/shared/schemas/<domain>.ts`
- Server data goes through TanStack Query (invalidate after mutations). UI state lives in React state/context and the feature stores.
- Comments, TSDoc and UI copy are written in Korean.
- **UI** (ESLint-enforced in `src/client/**/*.tsx`, except `components/ui/**`):
  - Prefer a shadcn registry component over a hand-written pattern (menus, toggles, fields, empty states, toasts, sidebar…). Add one with `pnpm exec shadcn add <name>` and delete `components/ui/*` files nothing imports.
  - Keep `components/ui/*` as the CLI generates it (Prettier and the Tailwind lint skip it). The only local edits are Korean copy (`닫기`, `사이드바…`) and the `sonner.tsx` import of `#components/theme-provider` (the Vite dark-mode guide's provider, not next-themes). Re-apply them after `--overwrite`.
  - Use components with their variants; avoid restyling them with `className` beyond layout (width, position, spacing).
  - Colors, radii and sizes come from the tokens in `src/client/index.css` (`bg-background`, `text-muted-foreground`, `bg-primary`, `text-destructive`, `text-warning`, `sidebar-*`). No palette colors (`zinc-500`), no `dark:`, no arbitrary values (`text-[11px]`); add a token to `@theme` instead (`text-2xs`). `text-white`/`bg-black` are fine on the stage and over slide thumbnails.
  - Compose classes with `cn` (package `cn`), not template literals. Class order is enforced by `better-tailwindcss` (`pnpm lint:fix`).
  - Icons come from `lucide-react`; no inline `<svg>`. Icon-only buttons use `components/common/IconButton` (aria-label + tooltip). Use `Tooltip`, never a native `title`.
  - Editor shortcuts treat only `[data-slot="dialog-content"]` and `[data-slot="alert-dialog-content"]` as modal. Ribbon popovers pass `initialFocus={false}` and their buttons prevent `mousedown` so the lyrics caret survives.
  - Inline `style` is allowed only for user content (stage, canvas, font/colour previews, drag coordinates); the file list is `STYLE_ALLOWED_FILES` in `eslint.config.mjs`.
  - Base UI in jsdom: popups and sonner toasts update asynchronously (`waitFor`/`findBy`), outside clicks need `pointerDown` + `click`, and a `Select` option needs `pointerDown` → `mouseUp` → `click`. Components that read the sidebar or theme context need `SidebarProvider`/`ThemeProvider` in the test tree.
- **Comments**: code is the source of truth.
  - No inline comments inside functions, JSX or tests. That covers restated logic, step numbers, TODOs, commented-out code, and milestone or spec tags (`M5`, `PRD 4.7`, `Task 4.5`).
  - The only exception is a workaround for a third-party or platform constraint, with a reference.
  - Write TSDoc only on exports, and explain why: business rules, side effects, security scoping, invariants.
  - Skip `@param` and `@returns` when they only repeat the types.

## Git, PRs and deploy

- After code changes, commit, push a branch and open a PR. `main` is protected: PRs are squash-merged after the `Typecheck, Lint & Test` check passes. Never merge with `--admin` or bypass the ruleset.
- Commit and PR titles use Conventional Commits with a scope, e.g. `feat(auth): ...`, `refactor(repo): ...`, `chore(deploy): ...`.
- Before pushing, `pnpm typecheck`, `pnpm lint` and `pnpm test` must pass. For UI changes, check the real rendering in Chrome against `pnpm dev`.
- Deploys and production migrations run only in CI (`.github/workflows/ci-cd.yml` on push to `main`: build, then `db:migrate:prod`, then `wrangler deploy`). Don't run `pnpm deploy` or `pnpm db:migrate:prod` locally. Secrets, rollback, the domain move and OAuth setup are in `docs/ops/deploy-runbook.md`.
