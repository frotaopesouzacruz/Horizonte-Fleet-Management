# Horizonte Fleet Management (HFM)

Corporate multi-tenant fleet management SaaS. PostgreSQL/Supabase as the transactional core, Next.js as the
application layer.

## Status

| Stage | Scope | State |
| --- | --- | --- |
| 01 | Database and back-end foundation | Applied to the Dev project and validated |
| 02 | Visual identity, design system and themes | Foundation in place; official brand files pending |

Operational modules (fleet, maintenance, tyres, checklists, fuel, fines, washing, documents, suppliers, reports)
are not implemented yet. They build on the foundation without redefining master data or the palette.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Radix UI · lucide-react · Supabase (PostgreSQL 17).

## Getting started

```bash
npm install
cp .env.example .env     # fill in the Supabase URL and anon key
npm run dev              # http://localhost:3000
```

Useful scripts:

```bash
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run build            # production build
npm run build:ui-test    # same build with /dev/design-system enabled (required before test:ui)
npm run test:ui          # Playwright: themes, responsive shell, accessibility
npm run db:push          # apply migrations to the linked Supabase project
npm run db:types         # regenerate src/types/database.types.ts
npm run db:test          # database test suites (pg_prove)
```

## Layout

```
docs/
  architecture/database-foundation.md      principles, entities, RLS, RBAC, audit, ERD
  architecture/database-foundation-review.md  review outcome and accepted trade-offs
  design-system.md                         tokens, themes, components, rules for new modules
public/brand/                              official logo and background files
src/
  app/                                     routes: (app) shell group, login, dev/design-system
  components/{ui,layout,feedback,brand}/   design system
  design-system/{tokens,theme,foundations} tokens and theming
  types/database.types.ts                  generated from the database schema
supabase/
  migrations/                              versioned schema (source of truth)
  tests/                                   RLS, RBAC, integrity and audit suites
tests/ui/                                  Playwright UI and accessibility checks
```

## Conventions

- The database enforces integrity and authorization; the client never decides what a user may see.
- Master data has a single source of truth. Modules reference it by id and never copy plate, unit or driver names.
- No colour, radius, shadow or font size is hardcoded in a component: everything comes from the design tokens.
- Every component and page is verified in light **and** dark themes.

See `docs/architecture/database-foundation.md` and `docs/design-system.md` before adding a module.
