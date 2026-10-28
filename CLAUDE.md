# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A web slide tool for church worship teams: song decks and sets, fullscreen projection over looping video backgrounds, and a public deck library. Next.js (App Router) with a Hono API under `/api`, running as one Cloud Run container on Firestore and Cloud Storage (`docs/deploy-gcp.md`).

## Workflow

```bash
pnpm emulators       # Firestore emulator on :8080 (needs Java 21); keeps data in .data/firestore between runs. Leave it running
pnpm db:seed:local   # creates .env.local if missing, reseeds dev accounts, the public library, presentations and image backgrounds (.data/media)
pnpm dev             # http://localhost:5173. Sign in with a dev account on the login screen; fill in an OAuth client in .env.local only to test social login
pnpm build && pnpm start   # production build with the service worker, against the emulator (offline testing)

pnpm typecheck && pnpm lint && pnpm test   # must pass before pushing (the CI gate). Tests start their own emulator on :8085
pnpm test src/db/queries/decks.test.ts     # one file; add `-t "<name>"` for one test, `--project server|client|node` for one project
```

- Vitest has three projects (`vitest.config.ts`): `server` (`src/server`, `src/db`, against the emulator), `client` (`src/client`, jsdom, with `next/navigation`/`next/link` stubbed by `src/client/test/next/*`) and `node` (`src/shared`, `config`, `scripts`, `infra`).
- Run `pnpm fonts:previews` after editing `noonnuFontCatalog.ts`.
- For UI changes, check the real rendering in Chrome against `pnpm dev`.
- Deploys (image, Firestore rules and indexes) run only in CI on push to `main`.
- Any script run with `--target=remote` reads or writes production Firestore or GCS, and some delete or move user data. Ask before every such run, previews included.
- `next dev` re-creates `AGENTS.md` with its agent-rules block. Next is 16.x; read `node_modules/next/dist/docs/` before relying on remembered Next APIs.

## Architecture

- **Local-first client.** The browser keeps presentations, songs, folders and backgrounds in IndexedDB (`src/client/lib/storage`); the UI reads and writes there. `src/client/lib/sync` pushes local changes and pulls server changes (boot delta pull, schedulers, listeners for own and shared presentations, cross-tab `storageSync`) and must flush before projection and sign-out. Projection works offline: the service worker precaches the app shell and `src/client/features/offline` caches background videos and fonts.
- **API.** `src/app/api/[[...route]]/route.ts` hands every `/api/*` request to the Hono app in `src/server/index.ts`. Tests build it with `createApp(deps)` to swap the session reader and hit the real routes. Error bodies are `{ error }` with a Korean sentence the client shows as is.
- **Shared contract.** Zod schemas, constants and copy in `src/shared` (`#shared`) are imported by both the server and the client.

## Conventions

### Documentation

- Keep documentation to a minimum. Code is the source of truth, so don't write docs for anything the code already shows. Duplicated docs drift out of date and end up misleading.
- Document only what the code can't tell you, when it's needed. That includes this file.

### Git and PRs

- After code changes, commit, push a branch and open a PR. `main` is protected: PRs are squash-merged after the `Typecheck, Lint & Test` check passes. Never merge with `--admin` or bypass the ruleset.
- Commit and PR titles use Conventional Commits with a scope, e.g. `feat(auth): ...`, `refactor(repo): ...`, `chore(deploy): ...`.

### Comments

- Comments, TSDoc and UI copy are written in Korean. UI copy lives in `src/client/copy/*` (`#copy/*`); server errors, Zod messages and the app name live in `src/shared/copy/*`. Reuse an existing key for the same sentence instead of adding a new one.
- UI copy follows Toss UX writing: sentences in 해요체 (`~해요`, `~했어요`, `~할까요?`, `~해 주세요`), active and positive; buttons and labels stay noun phrases (`저장`, `사본 만들기`). One or two sentences, no repeating what the title says, no developer terms, and failures say what to do next. `src/client/copy/tone.test.ts` rejects 합니다체; register new copy modules there. The legal pages stay formal.
- Terms: 프레젠테이션 (not 세트/문서), 곡 (not 찬양곡), 보관함, 공유 라이브러리, 송출.
- No inline comments inside functions, JSX or tests: no restated logic, step numbers, TODOs, commented-out code, or milestone and spec tags (`M5`, `PRD 4.7`, `Task 4.5`). The only exception is a workaround for a third-party or platform constraint, with a reference.
- Write TSDoc only on exports, and explain why: business rules, side effects, security scoping, invariants. Skip `@param` and `@returns` when they only repeat the types.

### Code

- Exported functions and endpoints get explicit return types. `const` by default, async/await.
- Naming: components `PascalCase.tsx`, hooks and utils `camelCase.ts`, Zod schemas grouped by domain in `src/shared/schemas/<domain>.ts`.
- Declare each model and API contract once as a Zod schema and derive types with `z.infer`.
- Server data goes through TanStack Query (invalidate after mutations); UI state lives in React state/context and the feature stores.
- When simplifying a screen, cut helpers that duplicate a direct-manipulation path instead of relocating them. Confirm before removing a whole product area.

### Database (Firestore)

- Collections, document types and typed accessors live in `src/db/collections.ts`; queries in `src/db/queries/`, operator tasks in `src/db/ops/` (run through `scripts/*.mjs`). Store empty values as `null`, never omit the field: `where(field, "==", null)` doesn't match a missing field.
- Firestore has no foreign keys, CHECK constraints or triggers. A write that used to rely on them does the work itself in the same transaction: deleting a presentation deletes its copies and members (`queries/cascade.ts`), deleting a song clears `forkedFrom`/report `deckId` pointing at it, forking bumps `forkCount`, unknown `backgroundId`s are saved as `null`. Read everything first, then write (a transaction can't read after writing).
- Every song write passes the final document through `withDeckIndex` (`src/db/deckIndex.ts`). It sets `listed`, the single definition of public scope that every public-library query filters on, and `searchGrams`, the bigram index the library search narrows candidates with.
- Queries that order or range over more than one field need a composite index in `firestore.indexes.json` (the emulator doesn't check). Prefer equality filters plus sorting in memory for per-user lists so they need no index.
- There is no row-level security. Every private query or mutation filters by the session's user id. `firestore.rules` denies all browser access; only the server (service account) reads and writes.

### UI

- Prefer a shadcn registry component (`pnpm exec shadcn add <name>`) over a hand-written pattern, and delete `components/ui/*` files nothing imports. Use components through their variants; limit `className` to layout (width, position, spacing).
- Keep `components/ui/*` as the CLI generates it. The only local edits are Korean copy (`닫기`, `사이드바…`) and the `sonner.tsx` import of `#components/theme-provider`; re-apply them after `--overwrite`.
- When a Tailwind value is missing, add a token to `@theme` in `src/client/index.css` rather than an arbitrary value.
- Accessibility target is WCAG 2.2 AA: color tokens keep 4.5:1 for text and 3:1 for focus rings and input borders (`styles.test.ts` checks them), text stays at `text-xs` (12px) or larger, and click targets stay at 24px or larger (touch screens get 44px from a global rule in `index.css`).
- Fonts are bundled from npm, never loaded from a CDN.

## Gotchas

- `src/app` files only map URLs to client routes in `src/client/routes`. The server renders just the loading screen: `App` waits for the session and IndexedDB before drawing a page, so don't fetch data in pages or layouts.
- Every dynamic route exports `generateStaticParams` returning `OFFLINE_SHELL_PARAM`. `scripts/buildServiceWorker.mjs` precaches that HTML and serves it for any id, offline included. One dynamic segment per route.
- Keep `cacheComponents` off (`next.config.ts` explains why).
- The Next router has no history state. Pass navigation data in the query (`?copy=1`) or sessionStorage (the projection return path).
- Root-layout modules (`App.tsx`, stores) import feature files directly, never a feature barrel (`features/editor`, `features/drive`), so the editor and drive code (react-moveable, @dnd-kit) stays out of every page's first load.
- Import `betterAuth` from `better-auth/minimal`. The default entry bundles Kysely and its dialects; auth data goes through the Firestore adapter (`src/db/auth/firestoreAdapter.ts`).
- Changing a stored field: the previous release keeps running on the same Firestore while a deploy rolls out, and old documents keep their old shape. IndexedDB on cached clients holds old shapes too. Keep changes additive, read missing fields with a fallback, and backfill with a script before relying on a new field. Raising a length limit or adding a font or style key is such a change too, and the wait is days, not one deploy: cached clients clamp over-long text when they load or push it and can't read unknown fonts, so ship the schema that accepts the value first and let the UI write it only after cached clients have updated.
- Media responses over 32 MiB go out without `content-length` (chunked). Cloud Run caps sized HTTP/1 responses at 32 MiB, and background videos are hundreds of MB.
