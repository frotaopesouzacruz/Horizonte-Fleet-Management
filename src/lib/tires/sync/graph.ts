/**
 * Cliente mínimo da Microsoft Graph para ler a planilha oficial dos pneus no
 * SharePoint — só leitura, credenciais de APLICATIVO (client credentials do
 * Entra ID), nunca a URL pública da interface do SharePoint.
 *
 * O arquivo é localizado por site → biblioteca → caminho e os ids resolvidos
 * ficam guardados (se o item some ou é substituído, a localização é refeita
 * pelo caminho). Cada chamada tem tempo limite e repete só o que é
 * transitório (429/5xx, respeitando Retry-After). Erros viram códigos
 * estáveis que a sincronização registra.
 *
 * Variáveis do servidor (nunca expostas ao navegador):
 *   MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET
 * Permissão de aplicativo recomendada: Sites.Selected (concedida só ao site
 * Horizonte Fleet Management) — ou Sites.Read.All / Files.Read.All.
 */

export type GraphErrorCode =
  | "credenciais_ausentes"
  | "graph_autenticacao"
  | "graph_sem_permissao"
  | "graph_nao_encontrado"
  | "graph_indisponivel"
  | "graph_tempo_esgotado"
  | "graph_resposta_invalida"
  | "arquivo_grande_demais";

export class GraphError extends Error {
  constructor(
    public readonly code: GraphErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Sobrescritas só para testes (servidor simulado). */
  graphBase?: string;
  loginBase?: string;
  timeoutMs?: number;
}

export interface DriveItemInfo {
  id: string;
  name: string;
  eTag: string | null;
  cTag: string | null;
  size: number | null;
  lastModified: string | null;
  webUrl: string | null;
}

export interface SourceLocation {
  siteHostname: string;
  sitePath: string;
  driveName: string;
  filePath: string;
  resolvedSiteId?: string | null;
  resolvedDriveId?: string | null;
  resolvedItemId?: string | null;
}

export interface ResolvedFile {
  siteId: string;
  driveId: string;
  item: DriveItemInfo;
}

/** O que a sincronização precisa da Graph (o teste injeta uma implementação). */
export interface GraphFileSource {
  locate(source: SourceLocation): Promise<ResolvedFile>;
  download(driveId: string, itemId: string, maxBytes: number): Promise<ArrayBuffer>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Configuração a partir das variáveis do servidor; null quando faltam credenciais. */
export function graphConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GraphConfig | null {
  const tenantId = env.MS_GRAPH_TENANT_ID?.trim();
  const clientId = env.MS_GRAPH_CLIENT_ID?.trim();
  const clientSecret = env.MS_GRAPH_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) return null;
  return {
    tenantId,
    clientId,
    clientSecret,
    graphBase: env.MS_GRAPH_BASE_URL?.trim() || undefined,
    loginBase: env.MS_LOGIN_BASE_URL?.trim() || undefined,
  };
}

const ITEM_SELECT = "$select=id,name,eTag,cTag,size,lastModifiedDateTime,webUrl,file";

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** "Documentos Compartilhados" e "Shared Documents" são a mesma biblioteca padrão. */
const DEFAULT_LIBRARY = new Set(["documentoscompartilhados", "shareddocuments", "documentos"]);

export function encodeDrivePath(path: string): string {
  return path
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createGraphClient(config: GraphConfig, fetchImpl: FetchLike = fetch): GraphFileSource {
  const graphBase = (config.graphBase ?? "https://graph.microsoft.com/v1.0").replace(/\/$/, "");
  const loginBase = (config.loginBase ?? "https://login.microsoftonline.com").replace(/\/$/, "");
  const timeoutMs = config.timeoutMs ?? 30_000;
  let token: { value: string; expiresAt: number } | null = null;

  async function timed(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal, redirect: "follow" });
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") {
        throw new GraphError("graph_tempo_esgotado", "O SharePoint não respondeu dentro do tempo limite.");
      }
      throw new GraphError("graph_indisponivel", "Não foi possível conectar à Microsoft Graph (SharePoint).");
    } finally {
      clearTimeout(timer);
    }
  }

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });
    const res = await timed(`${loginBase}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new GraphError("graph_autenticacao", "As credenciais do aplicativo foram recusadas pelo Entra ID (Microsoft).", res.status);
    }
    const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!json?.access_token) throw new GraphError("graph_autenticacao", "O Entra ID não devolveu um token de acesso.");
    token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  async function call(path: string, kind: "json" | "binary" = "json"): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      const res = await timed(`${graphBase}${path}`, { headers: { authorization: `Bearer ${await accessToken()}` } });
      if (res.ok) return res;
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 800 * attempt);
        continue;
      }
      if (res.status === 401) {
        token = null;
        throw new GraphError("graph_autenticacao", "Acesso à Microsoft Graph recusado (token inválido ou expirado).", 401);
      }
      if (res.status === 403) {
        throw new GraphError("graph_sem_permissao", "O aplicativo não tem permissão de leitura no site/arquivo do SharePoint.", 403);
      }
      if (res.status === 404) throw new GraphError("graph_nao_encontrado", "Site, biblioteca ou arquivo não encontrado no SharePoint.", 404);
      throw new GraphError("graph_indisponivel", `A Microsoft Graph respondeu ${res.status}${kind === "binary" ? " ao baixar o arquivo" : ""}.`, res.status);
    }
  }

  async function json<T>(path: string): Promise<T> {
    const res = await call(path);
    try {
      return (await res.json()) as T;
    } catch {
      throw new GraphError("graph_resposta_invalida", "Resposta inesperada da Microsoft Graph.");
    }
  }

  const toItem = (raw: Record<string, unknown>): DriveItemInfo => {
    if (typeof raw.id !== "string") throw new GraphError("graph_resposta_invalida", "Item do SharePoint sem identificador.");
    return {
      id: raw.id,
      name: String(raw.name ?? ""),
      eTag: typeof raw.eTag === "string" ? raw.eTag : null,
      cTag: typeof raw.cTag === "string" ? raw.cTag : null,
      size: typeof raw.size === "number" ? raw.size : null,
      lastModified: typeof raw.lastModifiedDateTime === "string" ? raw.lastModifiedDateTime : null,
      webUrl: typeof raw.webUrl === "string" ? raw.webUrl : null,
    };
  };

  async function siteId(source: SourceLocation): Promise<string> {
    if (source.resolvedSiteId) return source.resolvedSiteId;
    const site = await json<{ id?: string }>(`/sites/${source.siteHostname}:${source.sitePath}`);
    if (!site.id) throw new GraphError("graph_resposta_invalida", "Site do SharePoint sem identificador.");
    return site.id;
  }

  async function driveId(site: string, source: SourceLocation): Promise<string> {
    if (source.resolvedDriveId) return source.resolvedDriveId;
    const list = await json<{ value?: { id: string; name: string }[] }>(`/sites/${encodeURIComponent(site)}/drives?$select=id,name`);
    const wanted = normalize(source.driveName);
    const drives = list.value ?? [];
    const found =
      drives.find((d) => normalize(d.name) === wanted) ??
      (DEFAULT_LIBRARY.has(wanted) ? drives.find((d) => DEFAULT_LIBRARY.has(normalize(d.name))) : undefined);
    if (!found) throw new GraphError("graph_nao_encontrado", `Biblioteca "${source.driveName}" não encontrada no site.`, 404);
    return found.id;
  }

  return {
    async locate(source) {
      // caminho rápido: ids já resolvidos; se o item sumiu, relocaliza pelo caminho
      if (source.resolvedSiteId && source.resolvedDriveId && source.resolvedItemId) {
        try {
          const raw = await json<Record<string, unknown>>(
            `/drives/${encodeURIComponent(source.resolvedDriveId)}/items/${encodeURIComponent(source.resolvedItemId)}?${ITEM_SELECT}`,
          );
          return { siteId: source.resolvedSiteId, driveId: source.resolvedDriveId, item: toItem(raw) };
        } catch (error) {
          if (!(error instanceof GraphError) || error.code !== "graph_nao_encontrado") throw error;
        }
      }
      let site: string;
      let drive: string;
      try {
        site = await siteId(source);
        drive = await driveId(site, source);
      } catch (error) {
        if (!(error instanceof GraphError) || error.code !== "graph_nao_encontrado" || !source.resolvedSiteId) throw error;
        site = await siteId({ ...source, resolvedSiteId: null });
        drive = await driveId(site, { ...source, resolvedDriveId: null });
      }
      const raw = await json<Record<string, unknown>>(`/drives/${encodeURIComponent(drive)}/root:/${encodeDrivePath(source.filePath)}?${ITEM_SELECT}`);
      return { siteId: site, driveId: drive, item: toItem(raw) };
    },

    async download(drive, itemId, maxBytes) {
      const res = await call(`/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(itemId)}/content`, "binary");
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new GraphError("arquivo_grande_demais", `O arquivo tem ${Math.round(declared / 1_048_576)} MB; o limite é ${Math.round(maxBytes / 1_048_576)} MB.`);
      }
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > maxBytes) {
        throw new GraphError("arquivo_grande_demais", `O arquivo passa do limite de ${Math.round(maxBytes / 1_048_576)} MB.`);
      }
      return buffer;
    },
  };
}
