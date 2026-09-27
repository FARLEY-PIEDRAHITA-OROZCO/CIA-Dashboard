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

function renderPagina(
  filtros: Parameters<typeof PaginaSprints>[0]["filtros"],
  hoja = 1,
) {
  return envolver(<PaginaSprints filtros={filtros} hoja={hoja} />);
}

/** Fila de la tabla de sprints a partir de su encabezado. */
async function filaDe(nombre: RegExp): Promise<HTMLElement> {
  return (await screen.findByRole("rowheader", { name: nombre })).closest("tr") as HTMLElement;
}

/**
 * Espera a que el catálogo esté cargado.
 *
 * Se busca el encabezado de fila y no un texto suelto: «Sprint 45» aparece
 * también en el KPI del sprint actual y en la celda de sprint de cada ítem, y
 * un `findByText` ambiguo falla con «Found multiple elements».
 */
async function esperarCatalogo(): Promise<void> {
  await screen.findByRole("rowheader", { name: /Sprint 45/ });
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
      hoja: 1,
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

describe("Paginación de la vista de sprints", () => {
  /** manyItems: devuelve `total` ítems y `hay_mas` en la última ventana. */
  function stubApiPaged(total: number) {
    const mock = vi.fn(async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      const params = new URL(url, "http://x").searchParams;
      const limite = Number(params.get("limite") ?? 200);
      const offset = Number(params.get("offset") ?? 0);
      const ventana = Math.max(0, Math.min(limite, total - offset));
      const items = Array.from({ length: ventana }, (_, i) => ({
        azure_id: 1000 + offset + i,
        tipo: "Task",
        titulo: `Ítem ${offset + i + 1}`,
        estado: "New",
        tags: "",
        sprint: "Proyecto de ejemplo\\Sprint 45",
        persona: { guid: "g-1", nombre: "Ana Pérez", url: "" },
        creado: "2026-09-01T10:00:00Z",
        modificado: "2026-09-20T10:00:00Z",
        cerrado: false,
      }));
      const cuerpo = url.includes("/api/sprints")
        ? SPRINTS
        : url.includes("/api/personas")
          ? PERSONAS
          : {
              items,
              total,
              offset,
              limite,
              hay_mas: offset + ventana < total,
              sprint_actual: "Sprint 45",
            };
      return new Response(JSON.stringify(cuerpo), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  it("oculta la paginación cuando todo cabe en una hoja", async () => {
    stubApiPaged(6);
    renderPagina({});

    await screen.findByText("Ítem 1");
    expect(screen.queryByRole("navigation", { name: "Paginación de ítems" })).toBeNull();
  });

  it("muestra el rango real de la hoja y cuántas hay", async () => {
    stubApiPaged(500);
    renderPagina({}, 2);

    expect(await screen.findByText(/Hoja 2 de 3/)).toBeInTheDocument();
    // Hoja 2 de 3 con 200 por página: ítems 201–400.
    expect(screen.getByText(/Mostrando 201–400 de 500 ítems/)).toBeInTheDocument();
  });

  it("pide la hoja siguiente escribiendo la página en el hash", async () => {
    stubApiPaged(500);
    renderPagina({});

    fireEvent.click(await screen.findByRole("button", { name: /Siguiente/ }));

    await waitFor(() => expect(window.location.hash).toBe("#/sprints?pagina=2"));
  });

  it("deshabilita «Anterior» en la primera hoja y «Siguiente» en la última", async () => {
    stubApiPaged(500);
    const { unmount } = renderPagina({}, 1);
    expect(await screen.findByRole("button", { name: /Anterior/ })).toBeDisabled();
    unmount();

    renderPagina({}, 3);
    await screen.findByText(/Hoja 3 de 3/);
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeDisabled();
  });

  it("explica que la hoja está vacía en vez de decir que no hay resultados", async () => {
    // Un total de 500 con la hoja en 999 no es «sin resultados»: es un hueco en
    // la paginación. Confundirlo hace pensar que el filtro falló.
    stubApiPaged(500);
    renderPagina({}, 999);

    expect(await screen.findByText(/No hay ítems en la hoja 999 de 3/)).toBeInTheDocument();
  });
});

describe("escritura retardada del filtro de persona", () => {
  it("no escribe en la URL ni pide datos por cada pulsación", async () => {
    // Retardo largo para que el temporizador no llegue a dispararse durante la
    // prueba: así la afirmación «cero escrituras» es determinista y no depende
    // de cuánto tarde en renderizar la página. Sin esto, el test pasó o falló
    // según la carga de la máquina.
    const mock = stubApi();
    envolver(<PaginaSprints filtros={{}} hoja={1} esperaMs={60_000} />);
    await esperarCatalogo();
    const antes = mock.mock.calls.length;

    const campo = screen.getByLabelText(/buscar persona/i);
    let escrito = "";
    for (const letra of "Luis") {
      escrito += letra;
      fireEvent.change(campo, { target: { value: escrito } });
    }

    // Cuatro pulsaciones: ni una entrada de historial, ni una petición.
    expect(window.location.hash).toBe("");
    expect(mock.mock.calls.length).toBe(antes);
    // El campo sí refleja lo tecleado: el retardo no congela la escritura.
    expect(campo).toHaveValue("Luis");
  });

  it("converge al valor completo en lugar de dejar prefijos a medias", async () => {
    const mock = stubApi();
    renderPagina({});
    await esperarCatalogo();
    const antes = mock.mock.calls.length;

    let escrituras = 0;
    const contar = () => {
      escrituras += 1;
    };
    window.addEventListener("hashchange", contar);
    try {
      const campo = screen.getByLabelText(/buscar persona/i);
      // Se teclea de verdad: cada pulsación añade una letra al valor anterior.
      let escrito = "";
      for (const letra of "Luis") {
        escrito += letra;
        fireEvent.change(campo, { target: { value: escrito } });
      }
      await waitFor(() => expect(window.location.hash).toBe("#/sprints?persona=Luis"));
    } finally {
      window.removeEventListener("hashchange", contar);
    }

    // La propiedad que importa: las escrituras no escalan con las pulsaciones.
    expect(escrituras).toBeGreaterThan(0);
    expect(escrituras).toBeLessThan(4);
    expect(mock.mock.calls.length).toBeLessThan(antes + 4);
  });

  it("no vuelve a escribir si el texto no ha cambiado", async () => {
    stubApi();
    renderPagina({ persona: "Ana" });
    await esperarCatalogo();
    // El valor de la URL ya es el del campo: nada debe reescribir el hash.
    await new Promise((r) => setTimeout(r, 400));
    expect(window.location.hash).toBe("");
    expect(screen.getByLabelText(/buscar persona/i)).toHaveValue("Ana");
  });

  it("el desplegable de persona aplica el filtro sin retardo", async () => {
    // El retardo es solo para el texto libre; un desplegable es una decisión
    // deliberada y no debe esperar.
    stubApi();
    renderPagina({});
    await esperarCatalogo();
    fireEvent.change(screen.getByLabelText(/^persona$/i), { target: { value: "g-1" } });

    await waitFor(() => expect(window.location.hash).toBe("#/sprints?persona=g-1"));
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
