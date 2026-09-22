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

The browser icons in `public/` come from the same two symbol derivatives.
Regenerate them with:

```
node scripts/brand-icons.mjs
```

## Ícones do navegador: transparentes, em duas variantes

| Arquivo | Origem | Fundo | Para |
| --- | --- | --- | --- |
| `favicon.ico` (16/32/48) | `symbol-light` | transparente | navegadores que não leem `media` |
| `favicon-16x16.png`, `favicon-32x32.png` | `symbol-light` | transparente | barra de abas **clara** |
| `favicon-dark-16x16.png`, `favicon-dark-32x32.png` | `symbol-dark` | transparente | barra de abas **escura** |
| `apple-touch-icon.png` | `symbol-dark` | Azul Horizonte | tela de início do iOS |
| `android-chrome-192/512.png` | `symbol-dark` | Azul Horizonte | Android, ícone mascarável |

**Por que duas variantes.** Uma versão anterior punha a marca sobre o azul
institucional, porque transparente os elementos navy sumiam contra a barra de
abas escura do Chrome e do Safari. O raciocínio estava certo para **um** arquivo
só — e a saída é não ter um só. O lockup oficial já vem em duas versões
justamente para isto: na variante escura os elementos navy são brancos. O
`<link rel="icon" media="(prefers-color-scheme: dark)">` deixa o navegador
escolher, e nenhuma cor é alterada: são os dois arquivos oficiais.

Conferido pixel a pixel: os dois favicons têm canal alfa e 76% dos pixels
completamente transparentes; os cantos têm alfa 0.

**Por que o iOS e o Android continuam opacos.** Não é inconsistência. O iOS
compõe transparência sobre **preto** e o Android recorta o ícone numa máscara —
os dois precisam de área opaca. Um PNG transparente ali vira a marca flutuando
sobre um quadrado preto na tela de início.

**A marca não é cortada.** Ela é ~2,8:1, então num quadrado ocupa cerca de um
terço da altura. Em 32px e acima — o que uma aba HiDPI realmente renderiza — ela
lê. Cortar para isolar o H leria melhor em 16px puro e está proibido pela §6.
