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
 * reduzir a margem lateral ao mínimo e centralizar. Em 16px a marca fica
 * pequena; em 32px e acima, que é o que os navegadores modernos realmente
 * usam em telas retina, ela lê bem.
 *
 * FUNDO. Azul Horizonte (#1F4B93), com a variante ESCURA do símbolo — a mesma
 * que o lockup oficial usa sobre fundo escuro. A §7 pede transparência em
 * primeiro lugar e admite "fundo institucional controlado" quando ela não dá
 * contraste, que é o caso: transparente, o traço navy do H e as duas lâminas
 * navy somem contra a barra de abas escura do Chrome e do Safari.
 *
 * O fundo cheio também resolve o que a §6 pede sobre área útil: uma marca de
 * 2,8:1 num quadrado branco deixa dois terços do ícone vazios. Nenhuma cor da
 * marca é alterada e nenhum elemento gráfico é cortado.
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

const sizes = [16, 32, 48, 180, 192, 512];
const icons = {};
for (const size of sizes) icons[size] = await squareIcon(dark.data, size);

writeFileSync("public/favicon-16x16.png", icons[16]);
writeFileSync("public/favicon-32x32.png", icons[32]);
writeFileSync("public/apple-touch-icon.png", icons[180]);
writeFileSync("public/android-chrome-192x192.png", icons[192]);
writeFileSync("public/android-chrome-512x512.png", icons[512]);
writeFileSync(
  "public/favicon.ico",
  buildIco([16, 32, 48].map((s) => ({ size: s, data: icons[s] }))),
);

console.log(`símbolo: ${light.info.width}×${light.info.height}`);
console.log("gerados: favicon.ico, favicon-16x16, favicon-32x32, apple-touch-icon,");
console.log("         android-chrome-192x192, android-chrome-512x512, symbol-light, symbol-dark");
