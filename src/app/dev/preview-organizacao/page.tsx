import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { OperationsView } from "@/app/(app)/organizacao/operacoes/operations-view";
import { GeographyView } from "@/app/(app)/organizacao/estados/geography-view";

/**
 * Renders the Organização screens against fixed data.
 *
 * The screens themselves read from Supabase behind a session, which makes them
 * impossible to look at from an environment that cannot reach the project. This
 * route feeds them the shape their queries return so the layout can be reviewed
 * and the UI suite can screenshot them. Same gate as the design system: absent
 * from any normal production build.
 */
export const metadata = { title: "Preview · Organização", robots: { index: false, follow: false } };

// GeographyView reads the URL, so this route cannot be prerendered. The real
// screen is dynamic already — it awaits searchParams — so only the preview
// needs saying so.
export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

const OPERATIONS = [
  { id: "1", name: "Last Mille MG", status: "active", employeeCount: 101, accessCount: 1, locationCount: 12 },
  { id: "2", name: "Merchandising", status: "active", employeeCount: 15, accessCount: 0, locationCount: 5 },
  { id: "3", name: "Redespacho", status: "active", employeeCount: 9, accessCount: 0, locationCount: 3 },
  { id: "4", name: "Redespacho - Belém", status: "active", employeeCount: 6, accessCount: 0, locationCount: 1 },
  { id: "5", name: "Frota", status: "active", employeeCount: 5, accessCount: 0, locationCount: 2 },
  { id: "6", name: "Gente", status: "active", employeeCount: 4, accessCount: 0, locationCount: 1 },
  { id: "7", name: "Gestão", status: "active", employeeCount: 2, accessCount: 0, locationCount: 1 },
  { id: "8", name: "Segurança", status: "active", employeeCount: 1, accessCount: 0, locationCount: 1 },
];

const LOCATIONS = [
  { id: "a", name: "Belém Do Pará", status: "active", cityId: 1501402, cityName: "Belém", uf: "PA" },
  { id: "b", name: "Brasilia", status: "active", cityId: 5300108, cityName: "Brasília", uf: "DF" },
  { id: "c", name: "Campo Grande", status: "active", cityId: null, cityName: null, uf: null },
  { id: "d", name: "Contagem", status: "active", cityId: 3118601, cityName: "Contagem", uf: "MG" },
  { id: "e", name: "Governador Valadares", status: "active", cityId: 3127701, cityName: "Governador Valadares", uf: "MG" },
  { id: "f", name: "Uberlândia", status: "active", cityId: 3170206, cityName: "Uberlândia", uf: "MG" },
];

const STATES = [
  { id: 31, uf: "MG", name: "Minas Gerais", region: "Sudeste", cityCount: 853, capitalName: "Belo Horizonte", capitalId: 3106200 },
  { id: 35, uf: "SP", name: "São Paulo", region: "Sudeste", cityCount: 645, capitalName: "São Paulo", capitalId: 3550308 },
  { id: 33, uf: "RJ", name: "Rio de Janeiro", region: "Sudeste", cityCount: 92, capitalName: "Rio de Janeiro", capitalId: 3304557 },
  { id: 43, uf: "RS", name: "Rio Grande do Sul", region: "Sul", cityCount: 497, capitalName: "Porto Alegre", capitalId: 4314902 },
  { id: 41, uf: "PR", name: "Paraná", region: "Sul", cityCount: 399, capitalName: "Curitiba", capitalId: 4106902 },
  { id: 52, uf: "GO", name: "Goiás", region: "Centro-Oeste", cityCount: 246, capitalName: "Goiânia", capitalId: 5208707 },
  { id: 53, uf: "DF", name: "Distrito Federal", region: "Centro-Oeste", cityCount: 1, capitalName: "Brasília", capitalId: 5300108 },
  { id: 15, uf: "PA", name: "Pará", region: "Norte", cityCount: 144, capitalName: "Belém", capitalId: 1501402 },
  { id: 29, uf: "BA", name: "Bahia", region: "Nordeste", cityCount: 417, capitalName: "Salvador", capitalId: 2927408 },
];

const CITIES = {
  rows: [
    { id: 3106200, stateId: 31, uf: "MG", stateName: "Minas Gerais", name: "Belo Horizonte", isCapital: true, isMunicipality: true, ddd: 31, timeZone: "America/Sao_Paulo", latitude: -19.9102, longitude: -43.9266 },
    { id: 3118601, stateId: 31, uf: "MG", stateName: "Minas Gerais", name: "Contagem", isCapital: false, isMunicipality: true, ddd: 31, timeZone: "America/Sao_Paulo", latitude: -19.9321, longitude: -44.0539 },
    { id: 3122306, stateId: 31, uf: "MG", stateName: "Minas Gerais", name: "Divinópolis", isCapital: false, isMunicipality: true, ddd: 37, timeZone: "America/Sao_Paulo", latitude: -20.1446, longitude: -44.891 },
    { id: 3127701, stateId: 31, uf: "MG", stateName: "Minas Gerais", name: "Governador Valadares", isCapital: false, isMunicipality: true, ddd: 33, timeZone: "America/Sao_Paulo", latitude: -18.8545, longitude: -41.9555 },
    { id: 2605459, stateId: 26, uf: "PE", stateName: "Pernambuco", name: "Fernando de Noronha", isCapital: false, isMunicipality: false, ddd: 81, timeZone: "America/Noronha", latitude: -3.8447, longitude: -32.4107 },
  ],
  total: 853,
  page: 1,
  pageSize: 50,
};

export default function PreviewPage() {
  if (!enabled) notFound();

  return (
    <AppShell permissions={["operations.view", "users.view"]}>
      <OperationsView operations={OPERATIONS} locations={LOCATIONS} />
      <GeographyView
        states={STATES}
        cities={CITIES}
        filters={{ stateId: 31, q: undefined, page: 1, pageSize: 50 }}
        operatingStates={["MG", "PA", "DF", "GO"]}
      />
    </AppShell>
  );
}
