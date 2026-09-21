# Official Horizonte brand assets

The four official files, stored exactly as delivered. They are consumed by
`src/components/brand/brand-logo.tsx` and `brand-background.tsx` and must never be
redrawn, cropped, recolored, re-encoded or regenerated.

| File                     | Official asset             | Intrinsic   | Used in                                    |
| ------------------------ | -------------------------- | ----------- | ------------------------------------------ |
| `logo-light.png`         | Logo Tema Claro            | 1920 × 1041 | Sidebar, login, institutional (light)      |
| `logo-dark.png`          | Logo Tema Escuro           | 1920 × 1041 | Sidebar, login, institutional (dark)       |
| `background-light.webp`  | Plano de Fundo Tema Claro  | 1672 × 941  | Login / onboarding / institutional (light) |
| `background-dark.webp`   | Plano de Fundo Tema Escuro | 1672 × 941  | Login / onboarding / institutional (dark)  |

Optimised derivatives are produced at request time by `next/image`; nothing here is
edited in place. Replacing a file is the only supported way to change the brand.

## Derivatives

`symbol-light.png` and `symbol-dark.png` are the **symbol band of the official
lockup** — rows 27–514 of each file, measured from the files themselves — cut out
and trimmed of transparent margin. Nothing is redrawn, recolored or re-proportioned;
they exist because the collapsed sidebar rail and the browser tab need the symbol
without the `HORIZONTE` / `Logística` wordmark stacked under it.

The browser icons in `public/` (`favicon.ico`, `favicon-16x16.png`,
`favicon-32x32.png`, `apple-touch-icon.png`, `android-chrome-*.png`) come from
`symbol-dark.png` centred on Azul Horizonte `#1F4B93`. Regenerate them with:

```
node scripts/brand-icons.mjs
```

Two decisions worth knowing before changing them:

* **Institutional background, not transparent.** Transparent loses the navy stroke
  of the H and the two navy blades against a dark tab strip. The official dark
  variant on the official blue keeps every element legible on both.
* **The mark is not cropped.** It is ~2.8:1, so in a square it fills about a third
  of the height. At 32 px and above — what a HiDPI tab actually renders — it reads.
  At a true 16 px it is small. Cropping to the H would read better there and would
  mean cutting graphic elements out of the mark, which is not ours to do.

There is no `favicon.svg`: the project has no official vector, and wrapping a raster
in an `<svg>` to call it one would be a lie with no benefit.
