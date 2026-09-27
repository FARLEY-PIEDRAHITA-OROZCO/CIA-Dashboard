/** Pruebas de la vista de pruebas: revelado progresivo y contrato de datos.
 *
 * Lo que se vigila sobre todo es lo que ya salió mal en las otras vistas:
 *
 * - Nada se pide a Azure al abrir sin pedirlo. La lista de historias sin caso son
 *   361 filas; tiene que esperar a un filtro.
 * - Una cobertura parcial se dice en pantalla. Es el número que decide si hay
 *   que escribir 361 casos de prueba o 400, y presentarlo como total engaña.
 * - Un fallo de un hook no tumba la vista: el índice de pruebas es otro y puede
 *   caerse sin que la cinta de sprints se entere.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ActivosPrueba,
  CoberturaPruebas,
  PlanDePrueba,
  ResumenPruebas,
  SinCubrir,
} from "../api/tipos";
import { useVista } from "../navegacion";
import { PaginaPruebas } from "./PaginaPruebas";

const SPRINTS: CoberturaPruebas["sprints"] = [
  {
    nombre: "Sprint 44",
    ruta: "Proyecto\\Sprint 44",
    historias: 24,
    cubiertas: 11,
    sin_cubrir: 13,
    pct_cubiertas: 45.8,
  },
  {
    nombre: "Sprint 45",
    ruta: "Proyecto\\Sprint 45",
    historias: 39,
    cubiertas: 5,
    sin_cubrir: 34,
    pct_cubiertas: 12.8,
  },
];

const RESUMEN: ResumenPruebas = {
  inventario: { planes: 44, suites: 457, casos: 3431, total: 3932 },
  estados: { "Test Case": { Design: 1577, Closed: 1722, Ready: 132 } },
  automatizacion: {
    casos: 3431,
    automatizados: 0,
    planificados: 53,
    manuales: 3378,
    pct_automatizado: 0,
  },
  diseno: { en_diseno: 1577, sin_mover: 624, dias: 180 },
  brecha: {
    historias: 601,
    cubiertas: 240,
    sin_cubrir: 361,
    pct_cubiertas: 39.9,
    parcial: false,
    requisitos_cubiertos_total: 352,
  },
  parcial: false,
  generado: "2026-09-27T00:00:00Z",
};

const PLANOS: PlanDePrueba[] = [
  {
    azure_id: 5324,
    titulo: "Auditorias tecnicas",
    estado: "Active",
    sprint: "Sprint 45",
    persona: "Leider Stiven Vaquiro Gaitan",
    modificado: "2026-02-01T00:00:00Z",
  },
  {
    azure_id: 5734,
    titulo: "Plan sin sprint",
    estado: "Active",
    sprint: "",
    persona: "",
    modificado: "2026-01-01T00:00:00Z",
  },
];

const ACTIVOS: ActivosPrueba = {
  resumen: {
    total: 3431,
    offset: 0,
    limite: 50,
    hay_mas: true,
    parcial: false,
    lotes_con_error: 0,
  },
  items: [
    {
      azure_id: 5733,
      tipo: "Test Case",
      titulo: "Caso de ejemplo",
      estado: "Design",
      sprint: "Sprint 45",
      persona: "Ana Diaz",
      tags: "smoke",
      prioridad: "2",
      automatizacion: "Not Automated",
      modificado: "2026-02-01T00:00:00Z",
      campos_editables: ["estado", "notas_qa", "prioridad", "tags"],
    },
  ],
  estados: { "Test Case": ["Design", "Ready", "Closed"] },
};

function cobertura(extra: Partial<CoberturaPruebas> = {}): CoberturaPruebas {
  const base = coberturaBase();
  return { ...base, ...extra, resumen: { ...base.resumen, ...(extra.resumen ?? {}) } };
}

function coberturaBase(): CoberturaPruebas {
  return {
    resumen: {
      historias: 601,
      cubiertas: 240,
      sin_cubrir: 361,
      pct_cubiertas: 39.9,
      requisitos_cubiertos_total: 352,
      parcial: false,
      lotes_con_error: 0,
      generado: "2026-09-27T00:00:00Z",
    },
    sprints: SPRINTS,
  };
}

const SIN_CUBRIR: SinCubrir = {
  resumen: {
    total: 361,
    offset: 0,
    limite: 50,
    hay_mas: true,
    parcial: false,
    lotes_con_error: 0,
  },
  items: [
    {
      azure_id: 1,
      titulo: "Historia sin caso",
      estado: "Active",
      sprint: "Sprint 45",
      persona: "Ana Diaz",
      modificado: "2026-02-01T00:00:00Z",
    },
    {
      azure_id: 2,
      titulo: "Historia sin sprint ni caso",
      estado: "Closed",
      sprint: "",
      persona: "",
      modificado: "2026-01-01T00:00:00Z",
    },
  ],
};

/** Rutas pedidas durante el test, para poder afirmar qué NO se descargó. */
let pedidas: string[] = [];

/** Stub de `fetch` que devuelve `Response` reales, como hace el navegador. */
function montar(overrides: {
  resumen?: ResumenPruebas;
  cobertura?: CoberturaPruebas;
  planes?: PlanDePrueba[];
  activos?: ActivosPrueba;
  sinCubrir?: SinCubrir;
  fallo?: string;
  /** Hash inicial; por defecto la vista de pruebas sin filtros. */
  hash?: string;
} = {}) {
  pedidas = [];
  // El hash va **antes** del render: `useVista` lo lee en el primer render, y
  // sin él la página no se llega a montar.
  window.location.hash = overrides.hash ?? "#/pruebas";
  const cuerpoDe = (url: string): unknown => {
    pedidas.push(url);
    if (url.includes("/pruebas/resumen")) return overrides.resumen ?? RESUMEN;
    if (url.includes("/pruebas/cobertura")) return overrides.cobertura ?? cobertura();
    if (url.includes("/pruebas/planes")) return overrides.planes ?? PLANOS;
    if (url.includes("/pruebas/activos")) return overrides.activos ?? ACTIVOS;
    if (url.includes("/pruebas/sin-cubrir")) return overrides.sinCubrir ?? SIN_CUBRIR;
    if (url.includes("/personas")) {
      return {
        personas: [
          {
            guid: "g1",
            nombre: "Ana Diaz",
            total: 12,
            abiertos: 3,
            bugs: 1,
            bugs_abiertos: 0,
            verificados: 0,
          },
        ],
        total: 1,
      };
    }
    return {};
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (overrides.fallo && url.includes(overrides.fallo)) {
        return new Response(JSON.stringify({ detail: "Azure no responde" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(cuerpoDe(url)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );

  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={cliente}>
      <VistaPruebas />
    </QueryClientProvider>,
  );
}

/**
 * Envoltorio que lee el hash, igual que `App`.
 *
 * Sin él, pulsar una columna de la cinta cambiaría `window.location.hash` pero
 * los props de la página seguirían vacíos: la prueba comprobaría que la URL se
 * escribe, no que la lista se pide. Con él se prueba el circuito entero.
 */
function VistaPruebas() {
  const vista = useVista();
  if (vista.pagina !== "pruebas") {
    return <p>fuera de la vista de pruebas</p>;
  }
  return <PaginaPruebas filtro={vista.filtro} hoja={vista.hoja} esperaMs={0} />;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

// Sin `cleanup`, el DOM de cada prueba se acumula y las búsquedas acaban
// encontrando el texto de la prueba anterior.
afterEach(() => {
  cleanup();
});

/** El titular del veredicto, que es lo único visible sin filtros. */
async function esperarVeredicto(): Promise<HTMLElement> {
  return (await screen.findByText(/historias sin caso de prueba ·/)) as HTMLElement;
}

describe("revelado progresivo", () => {
  it("al abrir no pide la lista de historias sin caso", async () => {
    montar();
    await esperarVeredicto();
    expect(pedidas.some((r) => r.includes("/pruebas/sin-cubrir"))).toBe(false);
  });

  it("el veredicto dice cuántas historias quedan sin caso", async () => {
    montar();
    // El titular es la cifra accionable. Sin ella, quien abre la vista no sabe
    // si hay 3 historias o 361 y no puede dimensionar el trabajo.
    expect((await esperarVeredicto()).textContent).toContain(
      "361 historias sin caso de prueba",
    );
  });

  it("la lista se explica en vez de dejar un hueco en blanco", async () => {
    montar();
    await esperarVeredicto();
    expect(
      screen.getByText(/361 historias sin caso de prueba en el proyecto/),
    ).toBeTruthy();
  });

  it("la lista aparece al elegir un sprint de la cinta", async () => {
    montar();
    await esperarVeredicto();

    fireEvent.click(screen.getByRole("button", { name: /Sprint 45/ }));

    await waitFor(() => {
      expect(pedidas.some((r) => r.includes("/pruebas/sin-cubrir"))).toBe(true);
    });
    expect(await screen.findByText("Historia sin caso")).toBeTruthy();
    // El filtro viaja en el hash, no en estado local: la URL es compartible.
    expect(window.location.hash).toContain("sprint=");
  });
});

describe("la lista de trabajo", () => {
  it("marca las historias sin sprint, que no se ocultan por un filtro", async () => {
    montar();
    await esperarVeredicto();
    fireEvent.click(screen.getByRole("button", { name: /Sprint 45/ }));

    const fila = (await screen.findByText("Historia sin sprint ni caso")).closest("li");
    // Si no se dice, parece que el filtro de sprint la dejó fuera.
    expect(within(fila as HTMLElement).getByText("sin sprint")).toBeTruthy();
  });

  it("pagina sin prometer más páginas de las que hay", async () => {
    montar();
    await esperarVeredicto();
    fireEvent.click(screen.getByRole("button", { name: /Sprint 45/ }));
    await screen.findByText("Historia sin caso");

    // 361 con páginas de 50 son 8; la última no se ofrece.
    const paginacion = screen.getByLabelText(/paginación/i);
    expect(paginacion.textContent).toContain("Hoja 1 de 8");
  });
});

describe("cobertura parcial", () => {
  it("se dice en pantalla cuando algún lote no se leyó", async () => {
    // El backend marca la parcialidad en las dos respuestas, porque salen de la
    // misma carga. Aquí seduce en el resumen, que es de donde la lee el veredicto.
    montar({
      resumen: {
        ...RESUMEN,
        parcial: true,
        brecha: { ...RESUMEN.brecha, parcial: true },
      },
      cobertura: cobertura({
        resumen: { ...coberturaBase().resumen, parcial: true, lotes_con_error: 2 },
      }),
    });
    // Con 361 historias sin caso, si puede haber más, la cifra es una cota.
    // Presentarla como total decide mal al equipo.
    expect(await screen.findByText(/Cobertura parcial/)).toBeTruthy();
  });

  it("no aparece cuando la lectura fue completa", async () => {
    montar();
    await esperarVeredicto();
    expect(screen.queryByText(/Cobertura parcial/)).toBeNull();
  });
});

describe("activos editables", () => {
  it("no se piden hasta que se abre el panel", async () => {
    montar();
    await esperarVeredicto();
    // 3.931 activos: la lista no se descarga porque sí.
    expect(pedidas.some((r) => r.includes("/pruebas/activos"))).toBe(false);
  });

  it("el panel se abre bajo demanda y trae los casos", async () => {
    montar();
    await esperarVeredicto();
    fireEvent.click(screen.getByRole("button", { name: /Editar casos, suites y planes/ }));

    await waitFor(() => {
      expect(pedidas.some((r) => r.includes("/pruebas/activos"))).toBe(true);
    });
    expect(await screen.findByText("Caso de ejemplo")).toBeTruthy();
  });

  it("explica que un plan no se puede abrir, en su pestaña", async () => {
    montar();
    await esperarVeredicto();
    fireEvent.click(screen.getByRole("button", { name: /Editar casos, suites y planes/ }));
    await screen.findByText("Caso de ejemplo");

    fireEvent.click(screen.getByRole("button", { name: "Planes" }));
    // Sin esta explicación, un plan que no abre parece un fallo de la aplicación.
    expect(await screen.findByText(/no tiene tags, descripción ni prioridad/)).toBeTruthy();
    expect(screen.getByText(/no es accesible por la API/)).toBeTruthy();
  });
});

describe("robustez", () => {
  it("un fallo del resumen no borra la cinta ya cargada", async () => {
    // Son dos índices distintos: que caiga el de pruebas no puede dejar la vista
    // en blanco cuando la cobertura ya llegó.
    montar({ fallo: "/pruebas/resumen" });
    expect(await screen.findByText(/No se pudo cargar la cobertura/)).toBeTruthy();
  });

  it("sin activos de prueba lo dice, sin error", async () => {
    montar({
      resumen: { ...RESUMEN, inventario: { planes: 0, suites: 0, casos: 0, total: 0 } },
      cobertura: cobertura({ sprints: [] }),
    });
    expect(
      await screen.findByText(/no tiene planes, suites ni casos de prueba/),
    ).toBeTruthy();
  });
});
