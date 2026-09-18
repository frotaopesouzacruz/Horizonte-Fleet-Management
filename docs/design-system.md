# HFM — Design System

Visual foundation of Horizonte Fleet Management. Corporate, dense, operational. Every colour, size and motion value
comes from a token; components never hardcode them.

## 1. Brand assets

The four official files are the source of truth, stored byte-for-byte as delivered. They are never redrawn,
recoloured, cropped or regenerated.

| File in `public/brand/` | Official asset | Intrinsic | Used by |
| --- | --- | --- | --- |
| `logo-light.png` | Logo Tema Claro | 1920 × 1041 | sidebar, login, institutional surfaces (light) |
| `logo-dark.png` | Logo Tema Escuro | 1920 × 1041 | sidebar, login, institutional surfaces (dark) |
| `background-light.webp` | Plano de Fundo Tema Claro | 1672 × 941 | login / onboarding / institutional (light) |
| `background-dark.webp` | Plano de Fundo Tema Escuro | 1672 × 941 | login / onboarding / institutional (dark) |

`BrandLogo` is the only component that decides which logo to show; `BrandBackground` is the only one that renders the
photograph. While a file is missing, `BrandLogo` falls back to a plain wordmark — that fallback is not the logo and
must not ship.

Rules that follow from the files themselves:

- The logo is a **stacked lockup** (symbol, `HORIZONTE`, `Logística`) with a fixed 1.844:1 ratio, exported as
  `LOGO_RATIO`. Width always follows height; the image is never cropped to isolate the symbol, not even in the
  collapsed rail.
- The wordmark band is ~23% of the lockup height, so **32px is the practical floor**. Current sizes: 46px on the
  authentication screens, 38px in the sidebar header and the design-system header, 26px in the collapsed rail.
- Both files are ~140 KB. The logo goes through `next/image` at `quality={100}` — right-sized and visually lossless,
  because flat colour and hard edges ring at the default quality. The photographs use the default quality.
- The background artwork is a composed scene with captions baked into it. It is therefore decorative
  (`alt=""`, `aria-hidden`) and never carries foreground copy of ours, which would compete with its own. Baked-in
  text is a WCAG 1.4.5 exception we accept for supplied brand artwork; no information exists only inside it.

## 2. Palette

Brand colours are fixed across themes: Horizonte blue `#1F4B93`, technological cyan `#008CCB`, gold `#F4B223`,
navy `#0B1426`.

| Role | Use |
| --- | --- |
| `primary` (blue) | main actions, active navigation, links, selection |
| `accent` (cyan) | data, information, secondary indicators, charts |
| `highlight` (gold) | brand accent only, in small doses — never a primary button |
| `success` / `warning` / `danger` / `info` / `neutral` | operational state, always paired with an icon or label |
| `chart-1…8` | ordered series palette, legible in both themes |

## 3. Typography

Montserrat (self-hosted, variable), weights 400/500/600/700. Base 14px for operational density.
Scale: `text-display`, `text-h1`…`text-h4`, `text-body`, `text-body-sm`, `text-label`, `text-caption`, `text-helper`.
Numeric columns use `tabular-nums`.

## 4. Themes

Light on near-white greys, dark on navy surfaces (never `#000`). Both are complete, equivalent experiences — a
component is not done until it is verified in both.

- Preference: `light` | `dark` | `system`, resolved as user preference → OS preference → light.
- Persisted in `localStorage` under `hfm.theme`; the class is applied to `<html>` before first paint, so there is no
  theme flash.
- Central management: `ThemeProvider` + `useTheme()` in `src/design-system/theme/`. Nothing else reads or writes the
  preference. `ThemeToggle` (menu) and `ThemeSegmented` (settings) are the two entry points.

## 5. Tokens

`src/design-system/tokens/` holds `colors.css` (brand, surfaces, borders, text, semantic, interaction, charts),
`shape.css` (radius, elevation, motion, layout, z-index) and `typography.css`. `theme/tailwind-theme.css` maps them
to Tailwind utilities (`bg-surface`, `text-fg-muted`, `border-border`, `rounded-md`, `shadow-sm`, `text-h2`…), so
switching a token changes the whole product.

Because the typographic scale is named (`text-body`, `text-h1`, …) instead of Tailwind's t-shirt sizes,
`src/lib/cn.ts` teaches tailwind-merge that scale. Without it, `text-body` and `text-primary-fg` land in the same
conflict group and the colour is silently dropped. **Add any new font-size token to that list.**

## 6. Components

`src/components/ui/` — Button, IconButton, Input, PasswordInput, Textarea, Select, Checkbox, RadioGroup, Switch, DateInput,
SearchField, FormField/FormGrid/FormActions, Label, Badge, StatusBadge, Card, Panel, Avatar, Separator, Table
primitives, Pagination, KpiCard, Breadcrumb, FilterBar, Tabs, Tooltip, Popover, DropdownMenu, Dialog, Drawer.

`src/components/feedback/` — Alert, Toast, Skeleton, Spinner, LoadingState, EmptyState, ErrorState, Progress,
ConfirmDialog.

`src/components/layout/` — AppShell, Sidebar, Topbar, PageHeader, ThemeToggle, navigation model.

`src/components/brand/` — BrandLogo, BrandBackground.

Routes in place: `/login`, `/recuperar-acesso`, `/dashboard` (inside the app shell) and the reference page
`/dev/design-system`. The reference page is served only outside production, or when
`NEXT_PUBLIC_ENABLE_DEV_PAGES=1` is set for the UI test run.

## 7. Spacing

4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Controls are 30 / 36 / 42px tall (`--control-height-sm|md|lg`); the default is
36px. Dense by design: this is a management system, not a landing page.

## 8. Radius

4, 6, 8, 10, 12px (`rounded-xs` … `rounded-xl`). `rounded-full` is for avatars, dots and switch thumbs only.

## 9. Logo usage

Light theme uses the colour version, dark theme the light-on-dark version, chosen automatically by
`<BrandLogo variant="auto" />`. The lockup is never cropped, stretched, recoloured or placed on a surface that harms
legibility — the collapsed rail shows the whole lockup scaled down to the rail width, not the symbol cut out of it.
`compact` only marks the placement as space-constrained; it does not crop anything.

## 10. Background usage

The official photograph belongs to login, onboarding, institutional and branding areas. It is never placed behind
tables, forms, grids, dashboards or any dense data.

It is a composed scene: an empty studio floor on the left, the vehicles and the route map in the middle, a panel of
capability captions at the right edge. So it is anchored `right center` — when the column is narrower than the
photograph, the captions are the part worth keeping — and it carries no copy of ours and no scrim, because the
artwork already says what that panel is for. Below `lg` the panel is `display:none`, so phones never download it.

A scrim (`soft` or `strong`) stays available for any future institutional surface that does need foreground text
over the image; it keeps that text legible without altering the image itself.

## 11. Dark mode

Not an inversion: navy surface levels (`background` → `surface` → `surface-secondary` → `surface-elevated`), borders
with low contrast, softened white text, lifted primary and accent so they hold contrast on navy, and the same gold.
Shadows are deeper and never used to fake elevation on flat surfaces.

## 12. Rules for new modules

1. Do not define a new palette, and do not create another Button, Input, Badge, Modal or Table. Extend the existing
   component or add a variant to it.
2. Never hardcode a colour, radius, shadow or font size. If a token is missing, add it to `tokens/` and map it in
   `tailwind-theme.css`.
3. Every component must be verified in light **and** dark before it is considered done.
4. State is never conveyed by colour alone: pair it with an icon or a label (`StatusBadge` already does).
5. Keep the operational density: no oversized cards, no card-in-card-in-card, no decorative icons, no marketing copy
   inside the authenticated application.
6. Motion stays between 120 and 250ms and must be functional; honour `prefers-reduced-motion` (already global).
7. Accessibility is part of the definition of done: label every control, keep focus visible, keep targets ≥36px, and
   run the axe checks in `tests/ui/a11y.spec.ts`. Any solid colour that carries white text must clear 4.5:1 — that
   constraint is why `accent`, `success`, `warning` and `neutral` are darker than the raw brand swatches in the
   light theme (`--brand-cyan` stays pure for charts and graphics).

## 13. Density and rhythm

The root font-size is **16px**. It used to be 14px, which looked like a
reasonable way to make an operational product denser and was in fact the single
cause of the product reading as compressed: the type scale is declared in px and
never depended on it, but every Tailwind spacing utility is rem-based, so `px-6`
resolved to 21px, `gap-4` to 14px and `size-4` to 14px. Everything was 12.5%
tighter than the class name said.

The rule that follows: **the root controls the rhythm, the tokens control the
text.** Sizes that must not move with a container — table text, labels, headings
— stay in px in `tokens/typography.css`. Spacing stays in Tailwind's rem scale.

Scale in use:

| Role | Token | Size |
| --- | --- | --- |
| Hero (login only) | `text-display` | 34 / 40 |
| Page title | `text-h1` | 24 / 30 |
| Section title | `text-h2` | 18 / 24 |
| Card title | `text-h3` / `text-h4` | 16 / 14 |
| Body | `text-body` | 14 |
| Table, dense UI | `text-body-sm` | 13 |
| Caption | `text-caption` | 12 |
| Group label, eyebrow | `text-overline` | 11 |

`text-overline` is the only size below 12px and it never carries data — sidebar
group labels and section eyebrows, nothing else.

Layout tokens live in `tokens/shape.css`: `--sidebar-width` (248) and
`--sidebar-width-collapsed` (68), `--sidebar-item-height` (38), `--topbar-height`
(56), `--table-row-height` (48), `--table-header-height` (42),
`--content-max-width` (1760) and `--content-reading-width` (1120).

## 14. Data tables

An operational table's job is to be read, not to fit. The conventions:

- **Every column declares a width** sized so its own header reads in full.
  `Matrí…`, `Situa…` and `Acesso H…` were the symptom of columns with no floor.
- **`layout="fixed"` plus a table `minWidth`** equal to the sum of the visible
  widths. When the viewport is narrower the container scrolls sideways; columns
  are never squeezed below their floor.
- **Eight columns by default, the rest behind a Colunas menu**, persisted per
  browser. Twelve columns at once is what forced every header into an ellipsis.
  Nothing is lost: every field is in the detail drawer regardless.
- **One line per cell**, `truncate` with the full value in `title`. Two lines are
  allowed only where the second line is a different fact (name + e-mail).
- **The identity column is frozen** (`position: sticky`) together with the
  selection checkbox, so a horizontally scrolled row can still be named.
- **Below `lg` the table becomes cards.** A twelve-column table inside a 390px
  scroller is not a responsive table, it is a hidden one.

One trap worth remembering: `TableHeader` used to apply both `[&_th]:sticky` and
`[&_th]:relative`. tailwind-merge keeps the last position utility, so the sticky
header silently never stuck — and because a descendant selector outranks a
utility class on the cell itself, a `sticky` set by a caller was overridden too.
`sticky` is already a positioned value and anchors the header's `::after` rule
on its own; asking for both is what broke it.

## 15. Filters

Four filters carry almost every real query; the rest belong behind **Mais
filtros** with a count on the button. Eight selects on one line is how a toolbar
turns into a row of unreadable stubs. Applied filters are echoed as chips under
the bar, each removable, with a single "Limpar filtros".
