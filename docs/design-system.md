# HFM — Design System

Visual foundation of Horizonte Fleet Management. Corporate, dense, operational. Every colour, size and motion value
comes from a token; components never hardcode them.

## 1. Brand assets

The four official files are the source of truth. They are never redrawn, recoloured, cropped or regenerated.

| File in `public/brand/` | Official asset | Used by |
| --- | --- | --- |
| `logo-light.png` | Logo Tema Claro | sidebar, login, institutional surfaces (light) |
| `logo-dark.png` | Logo Tema Escuro | sidebar, login, institutional surfaces (dark) |
| `background-light.png` | Plano de Fundo Tema Claro | login / onboarding / institutional (light) |
| `background-dark.png` | Plano de Fundo Tema Escuro | login / onboarding / institutional (dark) |

`BrandLogo` is the only component that decides which logo to show; `BrandBackground` is the only one that renders the
photograph. While a file is missing, `BrandLogo` falls back to a plain wordmark — that fallback is not the logo and
must not ship.

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
`<BrandLogo variant="auto" />`. `compact` renders the square mark for the collapsed sidebar. The logo is never
cropped, stretched, recoloured or placed on a surface that harms legibility.

## 10. Background usage

The official photograph belongs to login, onboarding, institutional and branding areas. It is never placed behind
tables, forms, grids, dashboards or any dense data. A scrim (`soft` or `strong`) keeps foreground text legible
without altering the image itself.

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
