import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaginaSprints } from "./PaginaSprints";

const SPRINTS = {
  sprints: [
    {
      nombre: "Sprint 1",
      ruta: "Proyecto de ejemplo\\Sprint 1",
      total: 12,
      abiertos: 4,
      cerrados: 8,
      personas: 3,
      ultimo_cambio: "2026-08-01T10:00:00Z",
    },
    {
      nombre: "Sprint 45",
      ruta: "Proyecto de ejemplo\\Sprint 45",
      total: 83,
      abiertos: 67,
      cerrados: 16,
      personas: 16,
      ultimo_cambio: "2026-09-26T08:00:00Z",
    },
  ],
  total: 2,
  sprint_actual: "Sprint 45",
};

const PERSONAS = {
  personas: [
    {
      guid: "g-1",
      nombre: "Ana Pérez",
      total: 30,
      abiertos: 9,
      bugs: 4,
      bugs_abiertos: 2,
      verificados: 1,
    },
    {
      guid: "g-2",
      nombre: "Luis Gómez",
      total: 12,
      abiertos: 3,
      bugs: 1,
      bugs_abiertos: 0,
      verificados: 0,
    },
  ],
  total: 2,
};

const ITEMS = {
  items: [
    {
      azure_id: 501,
      tipo: "Bug",
      titulo: "Error de cálculo",
      estado: "Active",
      tags: "verificado-qa;qa",
      sprint: "Proyecto de ejemplo\\Sprint 45",
      persona: { guid: "g-1", nombre: "Ana Pérez", url: "" },
      creado: "2026-09-01T10:00:00Z",
      modificado: "2026-09-20T10:00:00Z",
      cerrado: false,
    },
  ],
  total: 1,
  sprint_actual: "Sprint 45",
};

const BRECHA = {
  resumen: {
    bugs: 143,
    bugs_cerrados_sin_verificar: 136,
    bugs_verificados_sin_cerrar: 0,
    historias: 601,
    historias_sin_evidencia: 410,
    verificados: 0,
    generado: "2026-09-26T12:00:00Z",
  },
  cerrados_sin_verificar: [
    {
      azure_id: 700,
      tipo: "Bug",
      titulo: "Cálculo duplicado",
      estado: "Closed",
      sprint: "Sprint 44",
      persona: "Ana Pérez",
      modificado: "2026-09-10T08:00:00Z",
    },
  ],
  verificados_sin_cerrar: [],
  historias_sin_evidencia: [],
};

/** Stub de `fetch` que sirve las rutas del índice local y de la analítica. */
function stubApi() {
  const mock = vi.fn(async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    const cuerpo = url.includes("/api/sprints")
      ? SPRINTS
      : url.includes("/api/personas")
        ? PERSONAS
        : url.includes("/api/analitica/verificacion")
          ? BRECHA
          : url.includes("/api/items")
            ? ITEMS
            : { configurada: true };
    return new Response(JSON.stringify(cuerpo), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function envolver(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function renderPagina(filtros: Parameters<typeof PaginaSprints>[0]["filtros"]) {
  return envolver(<PaginaSprints filtros={filtros} />);
}

/** Fila de la tabla de sprints a partir de su encabezado. */
async function filaDe(nombre: RegExp): Promise<HTMLElement> {
  return (await screen.findByRole("rowheader", { name: nombre })).closest("tr") as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("PaginaSprints", () => {
  it("muestra el catálogo con conteos y señala el sprint actual", async () => {
    stubApi();
    renderPagina({});

    expect(await screen.findByRole("rowheader", { name: /Sprint 45/ })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /Sprint 1/ })).toBeInTheDocument();

    const kpi = screen.getByText("Sprint actual").closest(".kpi");
    expect(within(kpi as HTMLElement).getByText("Sprint 45")).toBeInTheDocument();
  });

  it("el catálogo calcula el porcentaje de cierre de cada sprint", async () => {
    stubApi();
    renderPagina({});

    // Sprint 45: 16 de 83 cerrados ≈ 19 %.
    expect(within(await filaDe(/Sprint 45/)).getByText(/19% cerrado/)).toBeInTheDocument();
    // Sprint 1: 8 de 12 ≈ 67 %.
    expect(within(await filaDe(/Sprint 1/)).getByText(/67% cerrado/)).toBeInTheDocument();
  });

  it("escribe el filtro de sprint en el hash al elegir una fila", async () => {
    stubApi();
    renderPagina({});

    const fila = await filaDe(/Sprint 1/);
    fireEvent.click(within(fila).getByRole("button", { name: "Ver sprint" }));

    await waitFor(() => expect(window.location.hash).toContain("sprint="));
    // La URL codifica los espacios como `+`; se comprueba el viaje completo
    // con el mismo parser que usa el enrutador, no con una comparación cruda.
    const [, query = ""] = window.location.hash.split("?");
    const parametros = new URLSearchParams(query);
    expect(parametros.get("sprint")).toBe("Proyecto de ejemplo\\Sprint 1");
  });

  it("el hash con query se convierte en filtros", async () => {
    const { parsearHash } = await import("../navegacion");

    expect(parsearHash("#/sprints?tipo=Bug&soloAbiertos=1")).toEqual({
      pagina: "sprints",
      filtros: { tipo: "Bug", soloAbiertos: true },
    });
  });

  it("el resumen de filtros describe lo que se está viendo", async () => {
    stubApi();
    renderPagina({ sprint: "Proyecto de ejemplo\\Sprint 45" });

    expect(await screen.findByText(/sprint Sprint 45/)).toBeInTheDocument();
  });

  it("el botón de limpiar solo aparece si hay filtros activos", async () => {
    stubApi();
    const { unmount } = renderPagina({});
    await screen.findByRole("rowheader", { name: /Sprint 45/ });
    expect(screen.queryByRole("button", { name: /Limpiar/ })).not.toBeInTheDocument();
    unmount();

    renderPagina({ tipo: "Bug" });
    expect(await screen.findByRole("button", { name: /Limpiar 1 filtro/ })).toBeInTheDocument();
  });

  it("limpiar los filtros devuelve al hash sin query", async () => {
    stubApi();
    renderPagina({ tipo: "Bug", soloAbiertos: true });

    fireEvent.click(await screen.findByRole("button", { name: /Limpiar 2 filtros/ }));

    await waitFor(() => expect(window.location.hash).toBe("#/sprints"));
  });

  it("avisa cuando el proyecto no tiene sprints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ sprints: [], total: 0, sprint_actual: "" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    renderPagina({});

    expect(
      await screen.findByText("No se detectó ningún sprint en el proyecto."),
    ).toBeInTheDocument();
  });

  it("muestra el error del backend sin romperse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("503 Service Unavailable");
      }),
    );
    renderPagina({});

    expect(
      await screen.findByText(/No se pudo cargar el catálogo de sprints/),
    ).toBeInTheDocument();
  });

  it("los ítems filtrados muestran sprint, responsable y etiquetas", async () => {
    stubApi();
    renderPagina({ sprint: "Proyecto de ejemplo\\Sprint 45" });

    const fila = (await screen.findByRole("cell", { name: /Error de cálculo/ })).closest(
      "tr",
    ) as HTMLElement;
    expect(within(fila).getByText("Ana Pérez")).toBeInTheDocument();
    expect(within(fila).getByText("Sprint 45")).toBeInTheDocument();
    expect(within(fila).getByText("verificado-qa")).toBeInTheDocument();
  });
});

describe("PaginaAnalitica", () => {
  it("muestra la brecha de verificación con su conteo", async () => {
    stubApi();
    const { PaginaAnalitica } = await import("../analitica/PaginaAnalitica");
    envolver(<PaginaAnalitica />);

    expect(
      await screen.findByRole("heading", { name: /Brecha de verificación QA/ }),
    ).toBeInTheDocument();
    // 136 bugs cerrados sin verificar: el hallazgo principal.
    const kpi = screen.getByText("Bugs cerrados sin verificar").closest(".kpi");
    expect(within(kpi as HTMLElement).getByText("136")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Bugs cerrados que nadie verificó/ })).toBeInTheDocument();
    expect(screen.getByText("Cálculo duplicado")).toBeInTheDocument();
  });

  it("una señal caída no borra las otras", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: RequestInfo | URL) => {
        const url = String(entrada);
        if (url.includes("/api/analitica/aging")) {
          return new Response("{}", { status: 500 });
        }
        const cuerpo = url.includes("/api/analitica/verificacion")
          ? BRECHA
          : url.includes("/api/analitica/rezago")
            ? {
                resumen: {
                  sprints: 37,
                  sprint_referencia: "Sprint 45",
                  sprints_con_rezago: 32,
                  rezagados: 594,
                  generado: "2026-09-26T12:00:00Z",
                },
                sprints: [],
              }
            : { configurada: true };
        return new Response(JSON.stringify(cuerpo), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const { PaginaAnalitica } = await import("../analitica/PaginaAnalitica");
    envolver(<PaginaAnalitica />);

    // La señal caída reporta su error…
    expect(await screen.findByText(/No se pudo calcular/)).toBeInTheDocument();
    // …y las demás siguen visibles.
    expect(
      screen.getByRole("heading", { name: /Brecha de verificación QA/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Rezago entre sprints/ })).toBeInTheDocument();
    expect(screen.getByText("594")).toBeInTheDocument();
  });

  it("avisa cuando ninguna señal deja deuda de sprints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: RequestInfo | URL) => {
        const url = String(entrada);
        const cuerpo = url.includes("/api/analitica/verificacion")
          ? BRECHA
          : url.includes("/api/analitica/rezago")
            ? {
                resumen: {
                  sprints: 37,
                  sprint_referencia: "Sprint 45",
                  sprints_con_rezago: 0,
                  rezagados: 0,
                  generado: "",
                },
                sprints: [],
              }
            : { configurada: true };
        return new Response(JSON.stringify(cuerpo), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const { PaginaAnalitica } = await import("../analitica/PaginaAnalitica");
    envolver(<PaginaAnalitica />);

    expect(
      await screen.findByText("Ningún sprint anterior dejó trabajo abierto."),
    ).toBeInTheDocument();
  });
});
