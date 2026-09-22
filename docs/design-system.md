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

Two derivatives are cut from those files and nothing else is: `symbol-light.png` and `symbol-dark.png`, the symbol
band of the official lockup (rows 27–514, trimmed of transparent margin). They exist because the collapsed rail and
the browser tab have no room for the `HORIZONTE` / `Logística` wordmark stacked under the mark. From
`symbol-dark.png` on Azul Horizonte `#1F4B93` come the browser icons in `public/` — `favicon.ico` (16/32/48),
`favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` and `android-chrome-192/512`. Regenerate them with
`node scripts/brand-icons.mjs`; `public/brand/README.md` records the two decisions behind them (institutional
background rather than transparency, and no crop of the mark).

`BrandLogo` is the only component that decides which logo to show, `BrandSymbol` the only one that shows the mark
alone, and `BrandBackground` the only one that renders the photograph. While a file is missing, they fall back to a
plain wordmark or an `H` — those fallbacks are not the logo and must not ship.

Rules that follow from the files themselves:

- The logo is a **stacked lockup** (symbol, `HORIZONTE`, `Logística`) with a fixed 1.844:1 ratio, exported as
  `LOGO_RATIO`. Width always follows height; the image is never cropped to isolate the symbol, not even in the
  collapsed rail.
- The wordmark band is ~23% of the lockup height, so **32px is the practical floor** for the lockup. Current sizes:
  46px on the authentication screens, 36px in the sidebar header, the mobile drawer and the design-system header.
  Below that floor the lockup is not shrunk — `BrandSymbol` takes over, at 20px in the collapsed rail.
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
Scale: `text-display`, `text-h1`…`text-h4`, `text-body`, `text-body-sm`, `text-label`, `text-caption`,
`text-helper`, `text-overline`. Numeric columns use `tabular-nums`.

Every name in that scale must also be listed in `FONT_SIZES` in `src/lib/cn.ts`. tailwind-merge cannot tell a custom
size from a custom colour, so a name missing there is filed under `text-color`, and `cn("text-overline", …,
"text-fg-muted")` silently drops the size — which is exactly how the sidebar group labels ended up rendering at 16px
instead of 11px, wide enough to be truncated. Adding a size token is therefore two edits, not one.

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

`src/components/brand/` — BrandLogo, BrandSymbol, BrandBackground.

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
`<BrandLogo variant="auto" />` and `<BrandSymbol variant="auto" />`. The lockup is never cropped, stretched or
recoloured, and never placed on a surface that harms legibility.

Where the lockup does not fit — the 68px collapsed rail, the browser tab — the answer is `BrandSymbol`, the official
symbol band of the same files, not a shrunken lockup: at rail width `HORIZONTE` becomes three grey pixels. The
symbol is a cut of the official artwork, never a redrawing of it, and the wordmark is not deleted from the lockup —
it is simply outside that cut. `compact` only marks a placement as space-constrained; it does not crop anything.

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

Layout tokens live in `tokens/shape.css`: `--sidebar-width` (256) and
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

## 16. Navigation

The Sidebar is the one surface present on every authenticated screen, so its
model lives in a single file — `src/components/layout/navigation.ts` — and there
is no second list to keep in step. An entry has exactly one home; moving it in
that file is the only way it moves.

Six groups, in this order: **Administração** (Colaboradores e usuários, Perfis
e permissões), **Estrutura operacional** (Operações, Filiais, Tipos de
equipamento), **Governança operacional** (Lideranças, Fidelização), **Gestão de
frota** (Cadastro de frotas), **Aplicativos** (Check List de Frota) and
**Módulos futuros**, kept separate because every entry in it is still a
placeholder. Mixed in with working modules they made the product look finished
and the screens that worked hard to find.

**Aplicativos** é o grupo do que se OPERA no celular, não do que se administra.
A separação não é estética: quem abre o Check List de Frota está saindo para
rota, e encontrar isso no meio de telas de cadastro custa tempo em pé, ao lado
do veículo. O grupo nasceu com um aplicativo e foi desenhado para receber
outros sem virar lista de exceções.

Quando o aplicativo assumiu o endereço `/checklist`, o item planejado de mesmo
nome saiu de Módulos futuros e virou **Aderência de checklist** — que é outra
pergunta, e continua por construir. O aplicativo registra a inspeção; a
aderência cobra quem devia tê-la feito. Mantê-los homônimos faria o mesmo nome
aparecer duas vezes no menu significando coisas diferentes.

### O cabeçalho é a marca do PRODUTO

O lockup institucional — símbolo + `HORIZONTE` + `Logística` — diz de **quem** é
o sistema. Quem abre a sidebar já sabe disso; precisa saber **qual** sistema,
porque o HFM convive com outros produtos Horizonte. Por isso o topo traz o
símbolo oficial ao lado do nome do produto em tipografia, com um descritor
abaixo:

```
[símbolo]  Horizonte Fleet Management     12px, semibold
           CENTRAL OPERACIONAL            11px, overline, fg-muted
```

O arquivo da marca continua intocado: nada é redesenhado, recortado ou
recolorido. O símbolo entra como a imagem oficial; o nome é texto.

Foi isso que empurrou a faixa de 256px para 284px. Medido no navegador, o nome
precisa de 182px ao lado do símbolo, e em 256px sobravam 163 — o `truncate`
entregava "Horizonte Fleet Manag…". Encolher a tipografia até caber deixaria o
título do produto do tamanho do seu próprio subtítulo, o que é pior do que uma
faixa 28px mais larga. `tests/ui/brand.spec.ts` mede o corte em seis larguras de
desktop e exige zero.

Anatomy, both modes:

| | Expandida | Recolhida |
| --- | --- | --- |
| Faixa | `--sidebar-width` 276px | `--sidebar-width-collapsed` 68px |
| Marca | símbolo oficial 20px + nome do produto | símbolo oficial, 20px |
| Grupo | rótulo `text-overline` (11px) + accordion | régua de 1px, sem rótulo |
| Item | ícone 18px + rótulo, 38px de altura | ícone centrado, rótulo em `sr-only` |
| Rodapé | `HFM · v0.1` + controle de recolher | controle de expandir |

Decisions that are easy to undo by accident:

- **The brand band is exactly `--topbar-height`.** Sidebar and Topbar start on
  the same line. Nothing else goes in that band: stacking the mark and the
  collapse control there overflowed 56px and the symbol crossed into the Topbar.
  The collapse control lives in the footer, same position in both modes.
- **Group labels are never truncated.** The chevron is out of flow (absolute) so
  the label takes the whole width, and the rail was sized against the longest of
  them, `GOVERNANÇA OPERACIONAL`. `tests/ui/navigation.spec.ts` asserts both the
  11px size and zero overflow, at every supported width — the size matters
  because the truncation was caused by the wrong font size, not by the width.
- **Collapsed, every item carries an `sr-only` label.** The icon is
  `aria-hidden`, so without it the link reaches a screen reader with no name at
  all. The tooltip answers the person who sees the rail, not the one who hears
  it.
- **The active item is marked by a 3px rule on its own left edge**, plus the
  soft primary surface and `aria-current="page"`. Never by colour alone.
- **What is remembered is what someone chose**: `hfm.sidebar.collapsed`
  (applied to `<html data-sidebar>` before first paint, so the rail never flashes
  open) and `hfm.nav.closed`, which stores only the groups that were closed —
  everything starts open, because a menu that hides its contents on first visit
  is a menu nobody discovers.
- **Below `lg` the Sidebar is replaced by a Drawer**, never by a squeezed rail.
- **Hiding an entry is a courtesy, never the boundary.** `visibleNavigation`
  filters by permission, the route re-checks it and RLS enforces it. A menu
  hidden from someone is not a permission.
- No fictitious entries, and no entry that does not respond: a disabled
  "Configurações" pointing at a route that does not exist teaches people to
  distrust the menu. Planned modules are visibly separate, muted, non-clickable,
  and say why in a tooltip.

---

## 17. Camadas (z-index)

A escala vive em `shape.css` e é a única fonte. Nenhum componente escreve um
`z-index` literal — quem precisa de camada usa o token.

| Token | Valor | Quem ocupa |
|---|---|---|
| `--z-topbar` | 20 | Topbar |
| `--z-sidebar` | 30 | Sidebar |
| `--z-overlay` | 50 | Dialog, Drawer, ConfirmDialog (painel e fundo) |
| `--z-dropdown` | 60 | Select, Popover, DropdownMenu, Tooltip |
| `--z-toast` | 70 | Toast |

### O menu fica acima do modal

Esta é a regra que não é óbvia, e custou caro quando estava invertida.

Select, popover, menu e tooltip são **portados para o fim do `body`**, fora da
árvore do drawer ou do diálogo que os abriu. Enquanto a camada de menu ficou
abaixo da camada de overlay (40 contra 50), **toda lista suspensa dentro de um
formulário em painel abria atrás do painel**: a lista existia no DOM, o CSS a
dava como `visible`, e ainda assim ninguém conseguia usá-la — ela era pintada
por baixo e o clique caía no overlay, que fechava o formulário.

O efeito atingia o sistema inteiro, não uma tela: cargo, área, operação,
localidade, filial e perfil no cadastro de colaborador; tipo de equipamento,
subcategoria, marca, modelo, operação e filial no cadastro de frota; e qualquer
formulário em drawer construído depois.

Pôr o menu acima do modal não cria o problema inverso: um menu só existe
enquanto está aberto, e abrir um modal fecha o menu que estivesse aberto na
página. O toast continua por cima de tudo, porque ele avisa sobre o que acabou
de acontecer inclusive dentro de um modal.

`tests/ui/overlays.spec.ts` guarda a regra. Ele não pergunta se a opção existe
nem se ela está visível — as duas coisas eram verdade com o defeito no ar. Ele
pergunta quem o navegador entrega em `elementFromPoint` no centro da opção, que
é a única pergunta cuja resposta muda quando a camada está errada.

### Lista vazia diz que está vazia

Um menu que abre vazio e um menu que não abre são indistinguíveis para quem está
preenchendo o formulário — os dois parecem defeito. Toda lista alimentada por
cadastro usa `SelectEmpty` quando não tem itens, e diz o que falta cadastrar.
Assim a ausência vira um fato do cadastro, que a pessoa sabe resolver, em vez de
um sintoma que ela só pode reportar.
