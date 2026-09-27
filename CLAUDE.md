# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A web slide tool for church worship teams: song decks and sets, fullscreen projection over looping video backgrounds, and a public deck library.

## Workflow

```bash
cp config/dev.vars.example .dev.vars   # DEV_LOGIN_ENABLED=true enables the localhost dev login
pnpm db:migrate:local
pnpm dev

pnpm typecheck && pnpm lint && pnpm test   # must pass before pushing (the CI gate)
```

- Run `pnpm db:generate` after editing `src/db/schema/*`, `pnpm types` after editing `wrangler.jsonc` (needs `.dev.vars`, or the secrets drop out of `Env`), and `pnpm fonts:previews` after editing `noonnuFontCatalog.ts`.
- For UI changes, check the real rendering in Chrome against `pnpm dev`.
- Deploys and production migrations run only in CI on push to `main`. Don't run `pnpm deploy` or `pnpm db:migrate:prod` locally, and never set `DEV_LOGIN_ENABLED` in production secrets.
- `scripts/seedSelected.mjs --target=remote` writes to the production D1. Ask before running it.

## Conventions

### Documentation

- Keep documentation to a minimum. Code is the source of truth, so don't write docs for anything the code already shows. Duplicated docs drift out of date and end up misleading.
- Document only what the code can't tell you, when it's needed. That includes this file.

### Git and PRs

- After code changes, commit, push a branch and open a PR. `main` is protected: PRs are squash-merged after the `Typecheck, Lint & Test` check passes. Never merge with `--admin` or bypass the ruleset.
- Commit and PR titles use Conventional Commits with a scope, e.g. `feat(auth): ...`, `refactor(repo): ...`, `chore(deploy): ...`.

### Comments

- Comments, TSDoc and UI copy are written in Korean.
- No inline comments inside functions, JSX or tests: no restated logic, step numbers, TODOs, commented-out code, or milestone and spec tags (`M5`, `PRD 4.7`, `Task 4.5`). The only exception is a workaround for a third-party or platform constraint, with a reference.
- Write TSDoc only on exports, and explain why: business rules, side effects, security scoping, invariants. Skip `@param` and `@returns` when they only repeat the types.

### Code

- Exported functions and endpoints get explicit return types. `const` by default, async/await.
- Naming: components `PascalCase.tsx`, hooks and utils `camelCase.ts`, DB schema `src/db/schema/<table>.ts`, Zod schemas grouped by domain in `src/shared/schemas/<domain>.ts`.
- Declare each model and API contract once as a Zod schema and derive types with `z.infer`.
- Server data goes through TanStack Query (invalidate after mutations); UI state lives in React state/context and the feature stores.
- When simplifying a screen, cut helpers that duplicate a direct-manipulation path instead of relocating them. Confirm before removing a whole product area.

### Database (Drizzle ORM)

- Use the ORM as far as it goes. Queries, test fixtures and schema changes go through Drizzle (`src/db/queries/`, `src/db/schema/*` + `pnpm db:generate`).
- Raw `sql` only where Drizzle has no API (FTS5 `MATCH`, column arithmetic, SQLite JSON functions, schema defaults), with table and column objects interpolated, never string column names or `sql.raw`.
- D1 has no row-level security. Every private query or mutation filters by the session's `user_id`, and every public-library query goes through the public-scope condition.

### UI

- Prefer a shadcn registry component (`pnpm exec shadcn add <name>`) over a hand-written pattern, and delete `components/ui/*` files nothing imports. Use components through their variants; limit `className` to layout (width, position, spacing).
- Keep `components/ui/*` as the CLI generates it. The only local edits are Korean copy (`닫기`, `사이드바…`) and the `sonner.tsx` import of `#components/theme-provider`; re-apply them after `--overwrite`.
- When a Tailwind value is missing, add a token to `@theme` in `src/client/index.css` rather than an arbitrary value.
- Fonts are bundled from npm, never loaded from a CDN.

## Gotchas

- Main-chunk modules (`App.tsx`, the projection route, stores) import feature files directly, never a feature barrel (`features/editor`, `features/drive`). Rolldown treats everything behind a barrel as reachable and pulls the editor and drive chunks (react-moveable, @dnd-kit) back into the first load.
- Import `betterAuth` from `better-auth/minimal`. The default entry bundles Kysely and its dialects, which the Drizzle adapter doesn't use.
- D1 migrations:
  - All history is squashed into `0001_initial.sql`. A D1 that applied older migration files must be recreated; locally, delete `.wrangler/state/v3/d1` and run `pnpm db:migrate:local`.
  - Never drop or recreate a parent table (`decks`, `presentations`, …). D1 ignores `PRAGMA foreign_keys=OFF` in migrations, so the drop cascades deletes into child rows. Use `ALTER TABLE … ADD COLUMN`.
  - drizzle-kit drops `ON DELETE SET NULL`; write it by hand in the generated SQL.
  - CI applies migrations before deploying, so the previous release briefly runs on the new schema. Keep changes additive, and drop or rename a column only after the code stops using it.
