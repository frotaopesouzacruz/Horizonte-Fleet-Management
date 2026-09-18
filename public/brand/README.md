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

`favicon.svg` is **not** part of the brand set: it is a neutral placeholder tab icon.
Replace it with the official favicon when one exists.
