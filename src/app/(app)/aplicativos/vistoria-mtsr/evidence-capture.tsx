"use client";

import * as React from "react";
import { AlertTriangle, Camera, ImagePlus, Loader2, RotateCcw, Trash2, Wand2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import type { createEvidenceUpload, EvidenceUploadTicket } from "@/lib/mtsr/app-actions";
import type { MtsrAppContext } from "@/lib/mtsr/types";
import type { EvidenceRef } from "./draft";

/**
 * Captura e envio das fotos de um item da vistoria.
 *
 * O caminho de cada foto é: escolher (câmera ou galeria) → reduzir no próprio
 * aparelho (até 1600 px no maior lado, JPEG 0,82 — poupa os dados móveis de
 * quem está em campo) → pedir ao servidor um bilhete de envio para o caminho
 * de rascunho desta pessoa e deste envio → subir direto ao bucket privado pela
 * URL assinada → calcular o SHA-256 → devolver ao pai a referência
 * `{storagePath, mimeType, sizeBytes, sha256, capturedAt}`.
 *
 * Remover uma foto só a tira da lista: o servidor ignora objetos que o envio
 * não referencia (e a retenção os expurga depois).
 */
export type EvidenceConfig = MtsrAppContext["evidence"];

export type UploadFn = (ticket: EvidenceUploadTicket, body: Blob, contentType: string) => Promise<{ ok: boolean; error?: string }>;

export interface EvidenceLoaders {
  createEvidenceUpload: typeof createEvidenceUpload;
  upload: UploadFn;
}

export interface EvidenceProgress {
  uploading: number;
  failed: number;
}

export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.82;
/** Abaixo disto a foto já é pequena: vai como veio, sem recodificar. */
const SMALL_FILE_BYTES = 600 * 1024;

/** Envio real: o cliente do navegador sobe o arquivo pela URL assinada emitida pelo servidor. */
export const uploadToSignedUrl: UploadFn = async (ticket, body, contentType) => {
  const supabase = createClient();
  const { error } = await supabase.storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, body, { contentType, upsert: false });
  return error ? { ok: false, error: error.message || "Falha ao enviar a foto." } : { ok: true };
};

const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} MB` : `${Math.round(n / 1024)} KB`;

interface DecodedImage {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  release: () => void;
}

async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (ctx, width, height) => ctx.drawImage(bitmap, 0, 0, width, height),
      release: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      el.src = url;
    });
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw: (ctx, width, height) => ctx.drawImage(image, 0, 0, width, height),
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/**
 * Reduz a imagem no navegador. Devolve `null` quando ela já cabe em 1600 px e
 * não precisa ser recodificada (`force` recodifica mesmo assim — para formatos
 * que o bucket não aceita).
 */
export async function shrinkImage(file: Blob, { force = false }: { force?: boolean } = {}): Promise<Blob | null> {
  const image = await decodeImage(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height, 1));
    if (scale === 1 && !force) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    image.draw(ctx, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  } finally {
    image.release();
  }
}

/** Valida e prepara o arquivo escolhido: formato, redução e tamanho final. */
export async function prepareEvidence(file: File, config: EvidenceConfig): Promise<{ body: Blob; mimeType: string } | { error: string }> {
  const type = file.type || "";
  if (!type.startsWith("image/")) return { error: "Só são aceitas imagens (JPEG, PNG ou WebP)." };
  const accepted = config.mimeTypes.includes(type);
  let body: Blob = file;
  let mimeType = type;
  if (!accepted || file.size > SMALL_FILE_BYTES) {
    let shrunk: Blob | null = null;
    try {
      shrunk = await shrinkImage(file, { force: !accepted });
    } catch {
      shrunk = null;
    }
    if (shrunk && (shrunk.size < file.size || !accepted)) {
      body = shrunk;
      mimeType = "image/jpeg";
    }
  }
  if (!config.mimeTypes.includes(mimeType)) return { error: "Formato de foto não aceito (use JPEG, PNG ou WebP)." };
  if (body.size <= 0) return { error: "A foto está vazia." };
  if (body.size > config.maxBytes) return { error: `A foto deve ter até ${formatBytes(config.maxBytes)}, mesmo depois de reduzida.` };
  return { body, mimeType };
}

export async function sha256Hex(blob: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // Sem contexto seguro não há `crypto.subtle`; o servidor aceita sem o hash.
    return null;
  }
}

interface PhotoState {
  id: string;
  previewUrl: string | null;
  status: "uploading" | "ok" | "error";
  error?: string;
  body?: Blob;
  mimeType: string;
  sizeBytes: number;
  capturedAt: string;
  ref?: EvidenceRef;
}

/** Fotos de um rascunho recuperado: já estão no bucket, mas a miniatura local se perdeu. */
const fromRefs = (refs: EvidenceRef[]): PhotoState[] =>
  refs.map((ref) => ({
    id: ref.storagePath,
    previewUrl: null,
    status: "ok",
    mimeType: ref.mimeType,
    sizeBytes: ref.sizeBytes,
    capturedAt: ref.capturedAt,
    ref,
  }));

const okRefs = (photos: PhotoState[]) => photos.filter((p) => p.status === "ok" && p.ref).map((p) => p.ref as EvidenceRef);
const progressOf = (photos: PhotoState[]): EvidenceProgress => ({
  uploading: photos.filter((p) => p.status === "uploading").length,
  failed: photos.filter((p) => p.status === "error").length,
});

export interface EvidenceCaptureProps {
  componentId: string;
  componentCode: string;
  componentName: string;
  clientSubmissionId: string;
  config: EvidenceConfig;
  /** Fotos já enviadas (do rascunho). */
  evidence: EvidenceRef[];
  /** Chamado a cada mudança: só as fotos CONFIRMADAS no bucket, mais o andamento. */
  onChange: (refs: EvidenceRef[], progress: EvidenceProgress) => void;
  required: boolean;
  /** Destaca a falta de foto obrigatória (depois de tentar revisar). */
  highlight?: boolean;
  disabled?: boolean;
  loaders: EvidenceLoaders;
  /** Prévia sem sessão: mostra "Simular foto", que percorre o mesmo caminho com uma imagem gerada. */
  preview?: boolean;
}

export function EvidenceCapture({
  componentId,
  componentCode,
  componentName,
  clientSubmissionId,
  config,
  evidence,
  onChange,
  required,
  highlight = false,
  disabled = false,
  loaders,
  preview = false,
}: EvidenceCaptureProps) {
  const [initial] = React.useState(() => fromRefs(evidence));
  const [photos, setPhotos] = React.useState<PhotoState[]>(initial);
  // Fonte de verdade para os callbacks assíncronos (um envio termina depois de
  // vários renders); `photos` é a cópia que a tela desenha.
  const photosRef = React.useRef<PhotoState[]>(initial);
  const onChangeRef = React.useRef(onChange);
  const [notice, setNotice] = React.useState<string | null>(null);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const galleryRef = React.useRef<HTMLInputElement>(null);
  const max = Math.max(1, config.maxPerItem);

  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Libera as miniaturas locais ao sair da tela.
  React.useEffect(
    () => () => {
      for (const photo of photosRef.current) if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    },
    [],
  );

  const commit = React.useCallback((next: PhotoState[]) => {
    photosRef.current = next;
    setPhotos(next);
    onChangeRef.current(okRefs(next), progressOf(next));
  }, []);

  const patch = React.useCallback(
    (id: string, changes: Partial<PhotoState>) => commit(photosRef.current.map((p) => (p.id === id ? { ...p, ...changes } : p))),
    [commit],
  );

  const upload = React.useCallback(
    async (id: string) => {
      const photo = photosRef.current.find((p) => p.id === id);
      if (!photo?.body) return;
      const ticket = await loaders.createEvidenceUpload({ clientSubmissionId, componentId, mimeType: photo.mimeType, sizeBytes: photo.sizeBytes });
      if (!ticket.ok || !ticket.data) {
        patch(id, { status: "error", error: ticket.error ?? "Não foi possível preparar o envio da foto." });
        return;
      }
      const sent = await loaders.upload(ticket.data, photo.body, photo.mimeType);
      if (!sent.ok) {
        patch(id, { status: "error", error: sent.error ?? "Falha ao enviar a foto. Verifique a conexão." });
        return;
      }
      const sha256 = await sha256Hex(photo.body);
      patch(id, {
        status: "ok",
        error: undefined,
        ref: { storagePath: ticket.data.path, mimeType: photo.mimeType, sizeBytes: photo.sizeBytes, sha256, capturedAt: photo.capturedAt },
      });
    },
    [clientSubmissionId, componentId, loaders, patch],
  );

  const addFiles = async (files: File[]) => {
    setNotice(null);
    const room = max - photosRef.current.length;
    if (room <= 0) {
      setNotice(`Limite de ${max} fotos por item. Remova uma para adicionar outra.`);
      return;
    }
    if (files.length > room) setNotice(`Só ${room} ${room === 1 ? "foto cabe" : "fotos cabem"} a mais neste item (limite de ${max}).`);
    const batch = files.slice(0, room).map((file) => ({
      file,
      state: {
        id: crypto.randomUUID(),
        previewUrl: URL.createObjectURL(file),
        status: "uploading" as const,
        mimeType: file.type,
        sizeBytes: file.size,
        capturedAt: new Date(file.lastModified || Date.now()).toISOString(),
      },
    }));
    commit([...photosRef.current, ...batch.map((b) => b.state)]);
    for (const { file, state } of batch) {
      const prepared = await prepareEvidence(file, config);
      if ("error" in prepared) {
        patch(state.id, { status: "error", error: prepared.error });
        continue;
      }
      patch(state.id, { body: prepared.body, mimeType: prepared.mimeType, sizeBytes: prepared.body.size });
      void upload(state.id);
    }
  };

  const remove = (id: string) => {
    const photo = photosRef.current.find((p) => p.id === id);
    if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    commit(photosRef.current.filter((p) => p.id !== id));
  };

  const retry = (id: string) => {
    patch(id, { status: "uploading", error: undefined });
    void upload(id);
  };

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Permite escolher o mesmo arquivo de novo depois de removê-lo.
    event.target.value = "";
    if (files.length) void addFiles(files);
  };

  /** Prévia: uma imagem gerada no próprio navegador percorre todo o caminho (redução, bilhete, envio, hash). */
  const simulate = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 72;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "gray";
    ctx.fillRect(0, 0, 96, 72);
    ctx.fillStyle = "white";
    ctx.fillRect(24, 18, 48, 36);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return;
    const stamp = Date.now();
    void addFiles([new File([blob], `simulada-${stamp}.jpg`, { type: "image/jpeg", lastModified: stamp })]);
  };

  const okCount = photos.filter((p) => p.status === "ok").length;
  const uploading = photos.some((p) => p.status === "uploading");
  const missing = required && okCount === 0;
  const full = photos.length >= max;

  return (
    <div className="flex flex-col gap-2" data-testid={`mtsr-app-evidence-${componentCode}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-label font-medium text-fg">
          Fotos
          {required ? (
            <Badge variant={highlight && missing ? "danger" : "warning"} appearance="soft" size="sm">
              Foto obrigatória
            </Badge>
          ) : (
            <span className="text-caption font-normal text-fg-muted">Opcional</span>
          )}
        </span>
        <span className="text-caption tabular-nums text-fg-muted">
          {okCount} de {max}
        </span>
      </div>

      {photos.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2" aria-label={`Fotos de ${componentName}`}>
          {photos.map((photo, index) => (
            <li
              key={photo.id}
              data-testid="mtsr-app-photo"
              data-status={photo.status}
              className={cn(
                "relative aspect-square overflow-hidden rounded-md border bg-surface-secondary",
                photo.status === "error" ? "border-danger" : "border-border",
              )}
            >
              {photo.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob:), fora do otimizador de imagens
                <img src={photo.previewUrl} alt={`Foto ${index + 1} de ${componentName}`} className="size-full object-cover" />
              ) : (
                <span className="flex size-full items-center justify-center p-2 text-center text-caption text-fg-muted">Foto já enviada</span>
              )}
              {photo.status === "uploading" ? (
                <span className="absolute inset-0 flex items-center justify-center bg-surface/70 text-fg" role="status">
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                  <span className="sr-only">Enviando foto {index + 1}</span>
                </span>
              ) : null}
              {photo.status === "error" ? (
                <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-danger-soft px-1.5 py-1 text-caption text-danger-soft-fg">
                  <AlertTriangle className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{photo.error ?? "Falha no envio"}</span>
                </span>
              ) : null}
              <span className="absolute right-1 top-1 flex gap-1">
                {photo.status === "error" && photo.body ? (
                  <IconButton size="sm" variant="secondary" label={`Repetir envio da foto ${index + 1}`} onClick={() => retry(photo.id)} disabled={disabled}>
                    <RotateCcw />
                  </IconButton>
                ) : null}
                <IconButton size="sm" variant="secondary" label={`Remover foto ${index + 1}`} onClick={() => remove(photo.id)} disabled={disabled}>
                  <Trash2 />
                </IconButton>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" size="lg" leadingIcon={<Camera />} disabled={disabled || full} onClick={() => cameraRef.current?.click()}>
          Tirar foto
        </Button>
        <Button type="button" variant="outline" size="lg" leadingIcon={<ImagePlus />} disabled={disabled || full} onClick={() => galleryRef.current?.click()}>
          Galeria
        </Button>
      </div>
      {preview ? (
        <Button
          type="button"
          variant="ghost"
          size="lg"
          leadingIcon={<Wand2 />}
          disabled={disabled || full}
          data-testid={`mtsr-app-simulate-photo-${componentCode}`}
          onClick={() => void simulate()}
        >
          Simular foto
        </Button>
      ) : null}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple hidden tabIndex={-1} aria-hidden onChange={onPick} />
      <input ref={galleryRef} type="file" accept="image/*" multiple hidden tabIndex={-1} aria-hidden onChange={onPick} />

      <p className="text-caption text-fg-muted">
        Até {max} fotos por item (JPEG, PNG ou WebP, {formatBytes(config.maxBytes)} cada). As fotos são reduzidas no aparelho antes do envio.
      </p>
      {notice ? (
        <p className="text-caption text-fg-secondary" role="status">
          {notice}
        </p>
      ) : null}
      {uploading ? (
        <p className="text-caption text-fg-secondary" role="status">
          Enviando fotos… aguarde antes de revisar.
        </p>
      ) : null}
      {highlight && missing ? (
        <p className="text-caption font-medium text-danger" role="alert">
          Adicione ao menos uma foto para este item.
        </p>
      ) : null}
    </div>
  );
}
