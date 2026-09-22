/**
 * Gera os ícones do navegador a partir do símbolo oficial da Horizonte.
 *
 * O símbolo NÃO é redesenhado nem recolorido em lugar nenhum deste arquivo. Ele
 * é recortado da faixa superior do lockup oficial (`logo-light.png` /
 * `logo-dark.png`, linhas 27–514, medidas no próprio arquivo) e daí apenas
 * redimensionado. Um traço sequer da marca é desenhado aqui.
 *
 * ENQUADRAMENTO. A marca é larga — 1364 × 488, quase 2,8:1. Encaixada num
 * quadrado ela ocupa cerca de um terço da altura, e é isso mesmo: a §6 proíbe
 * cortar os elementos gráficos para "encher" o ícone, então o que se faz é
 * reduzir a margem lateral ao mínimo e centralizar.
 *
 * FUNDO: TRANSPARENTE, e por isso EM DUAS VARIANTES.
 *
 * Uma versão anterior deste arquivo punha a marca sobre o Azul Horizonte
 * porque, transparente, os elementos navy sumiam contra a barra de abas escura.
 * O raciocínio estava certo para UM arquivo só; a saída é não ter um só.
 *
 * O lockup oficial já vem em duas variantes justamente para isso: na variante
 * escura os elementos navy são BRANCOS. Então:
 *
 *   favicon-16/32.png         símbolo CLARO  (navy visível)  → barra clara
 *   favicon-dark-16/32.png    símbolo ESCURO (navy em branco) → barra escura
 *
 * e o `<link rel="icon" media="(prefers-color-scheme: dark)">` deixa o
 * navegador escolher. Nenhuma cor é alterada: são os dois arquivos oficiais.
 *
 * O .ico usa a variante clara, porque é o que navegadores antigos pedem e eles
 * não entendem `media`.
 *
 * EXCEÇÃO DELIBERADA: `apple-touch-icon` e os `android-chrome` continuam sobre
 * o azul institucional. O iOS compõe transparência sobre PRETO e o Android
 * recorta o ícone numa máscara — os dois precisam de área opaca, e um PNG
 * transparente vira uma marca flutuando em cima de um quadrado preto na tela
 * de início.
 *
 * Uso: node scripts/brand-icons.mjs
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const BRAND = "public/brand";
const SYMBOL_BAND = { left: 0, top: 27, width: 1920, height: 488 };
/** Azul Horizonte. Único literal de cor do arquivo, e é uma cor oficial. */
const HORIZONTE_BLUE = { r: 0x1f, g: 0x4b, b: 0x93, alpha: 1 };

/** Recorta a faixa do símbolo e apara a folga transparente em volta. */
async function extractSymbol(lockup) {
  const band = await sharp(lockup).extract(SYMBOL_BAND).png().toBuffer();
  return sharp(band).trim({ threshold: 10 }).png().toBuffer({ resolveWithObject: true });
}

/** O símbolo centralizado no quadrado institucional, com margem lateral de 2%. */
async function squareIcon(symbolPng, size) {
  const inner = Math.round(size * 0.96);
  const scaled = await sharp(symbolPng)
    .resize({ width: inner, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });

  return sharp({
    create: { width: size, height: size, channels: 4, background: HORIZONTE_BLUE },
  })
    .composite([
      {
        input: scaled.data,
        left: Math.round((size - scaled.info.width) / 2),
        top: Math.round((size - scaled.info.height) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** O símbolo centralizado num quadrado TRANSPARENTE, com margem lateral de 2%. */
async function transparentIcon(symbolPng, size) {
  const inner = Math.round(size * 0.96);
  const scaled = await sharp(symbolPng)
    .resize({ width: inner, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: scaled.data,
        left: Math.round((size - scaled.info.width) / 2),
        top: Math.round((size - scaled.info.height) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Container ICO com entradas PNG.
 *
 * O formato aceita PNG dentro de cada entrada desde o Vista, e é o que todo
 * navegador atual lê. Escrever os 22 bytes do cabeçalho à mão evita arrastar
 * uma dependência só para empacotar três imagens.
 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // 1 = ícone
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;

  entries.forEach((e, i) => {
    const at = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, at + 0);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, at + 1);
    dir.writeUInt8(0, at + 2); // paleta
    dir.writeUInt8(0, at + 3); // reservado
    dir.writeUInt16LE(1, at + 4); // planos
    dir.writeUInt16LE(32, at + 6); // bits por pixel
    dir.writeUInt32LE(e.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += e.data.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

const light = await extractSymbol(`${BRAND}/logo-light.png`);
const dark = await extractSymbol(`${BRAND}/logo-dark.png`);

writeFileSync(`${BRAND}/symbol-light.png`, light.data);
writeFileSync(`${BRAND}/symbol-dark.png`, dark.data);

// Transparentes: a aba do navegador. Duas variantes, uma por tema de barra.
const transparentSizes = [16, 32, 48];
const lightIcons = {};
const darkIcons = {};
for (const size of transparentSizes) {
  lightIcons[size] = await transparentIcon(light.data, size);
  darkIcons[size] = await transparentIcon(dark.data, size);
}

writeFileSync("public/favicon-16x16.png", lightIcons[16]);
writeFileSync("public/favicon-32x32.png", lightIcons[32]);
writeFileSync("public/favicon-dark-16x16.png", darkIcons[16]);
writeFileSync("public/favicon-dark-32x32.png", darkIcons[32]);
writeFileSync(
  "public/favicon.ico",
  buildIco(transparentSizes.map((s) => ({ size: s, data: lightIcons[s] }))),
);

// Opacos: tela de início do iOS e do Android, que compõem sobre preto ou
// recortam numa máscara. Aqui o fundo institucional não é escolha estética.
const opaqueSizes = [180, 192, 512];
const opaque = {};
for (const size of opaqueSizes) opaque[size] = await squareIcon(dark.data, size);

writeFileSync("public/apple-touch-icon.png", opaque[180]);
writeFileSync("public/android-chrome-192x192.png", opaque[192]);
writeFileSync("public/android-chrome-512x512.png", opaque[512]);

console.log(`símbolo: ${light.info.width}×${light.info.height}`);
console.log("transparentes: favicon.ico, favicon-16x16, favicon-32x32,");
console.log("               favicon-dark-16x16, favicon-dark-32x32");
console.log("opacos:        apple-touch-icon, android-chrome-192x192, android-chrome-512x512");
