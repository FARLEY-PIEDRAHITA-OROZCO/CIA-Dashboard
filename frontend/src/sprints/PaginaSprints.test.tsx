import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaginaSprints } from "./PaginaSprints";

/** Catálogo con tres sprints: uno cerrado, uno con deuda y el actual. */
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
      nombre: "Sprint 2",
      ruta: "Proyecto de ejemplo\\Sprint 2",
      total: 40,
      abiertos: 30,
      cerrados: 10,
      personas: 9,
      ultimo_cambio: "2026-09-10T10:00:00Z",
    },
    {
      nombre: "Sprint 3",
      ruta: "Proyecto de ejemplo\\Sprint 3",
      total: 10,
      abiertos: 7,
      cerrados: 3,
      personas: 4,
      ultimo_cambio: "2026-09-26T10:00:00Z",
    },
  ],
  total: 3,
  sprint_actual: "Sprint 3",
  // 62 ítems en sprints y 4 sin sprint: 66 en el índice.
  total_items: 66,
  asignados_a_sprint: 62,
};

const PERSONAS = {
  personas: [
    { guid: "g-1", nombre: "Ana Pérez", total: 30, abiertos: 9, bugs: 4, bugs_abiertos: 2, verificados: 1 },
    { guid: "g-2", nombre: "Luis Gómez", total: 12, abiertos: 3, bugs: 1, bugs_abiertos: 0, verificados: 0 },
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
      sprint: "Proyecto de ejemplo\\Sprint 3",
      persona: { guid: "g-1", nombre: "Ana Pérez", url: "" },
      creado: "2026-09-01T10:00:00Z",
      modificado: "2026-09-20T10:00:00Z",
      cerrado: false,
    },
  ],
  total: 1,
  offset: 0,
  limite: 200,
  hay_mas: false,
  sprint_actual: "Sprint 3",
};

/** Stub de `fetch` con conteo de peticiones, para las garantías de diseño. */
function stubApi(respuestaItems: unknown = ITEMS) {
  const mock = vi.fn(async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    const cuerpo = url.includes("/api/sprints")
      ? SPRINTS
      : url.includes("/api/personas")
        ? PERSONAS
        : url.includes("/api/items")
          ? respuestaItems
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
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}>{ui}</QueryClientProvider>);
}

type Props = Parameters<typeof PaginaSprints>[0];

function renderPagina(props: Partial<Props> = {}) {
  return envolver(<PaginaSprints filtros={{}} hoja={1} {...props} />);
}

/** Espera a la cinta, que es lo único visible sin filtros. */
async function esperarCinta(): Promise<HTMLElement> {
  return (await screen.findByRole("list", { name: /Sprints en orden cronológico/ })) as HTMLElement;
}

/** Peticiones a `/api/items`. */
function peticionesItems(mock: ReturnType<typeof stubApi>): number {
  return mock.mock.calls.filter((c) => String(c[0]).includes("/api/items")).length;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

/** El veredicto, por su nombre de región viva. */
async function esperarVeredicto(): Promise<HTMLElement> {
  return (await screen.findByRole("status", { name: "Veredicto" })) as HTMLElement;
}

describe("Nivel 1 · veredicto y cinta", () => {
  it("abre con una frase, no con una tabla de 37 filas", async () => {
    stubApi();
    renderPagina();

    const veredicto = await esperarVeredicto();
    // El total es el del índice (66), no la suma de las columnas (62): hay 4
    // ítems sin sprint y decirlo evita que la cinta parezca cubrirlo todo.
    expect(veredicto).toHaveTextContent("66 ítems en el proyecto");
    // 4 de Sprint 1 + 30 de Sprint 2: la deuda que arrastran.
    expect(veredicto).toHaveTextContent("34 ítems rezagados de 2 sprints");
    expect(veredicto).toHaveTextContent("4 ítems sin sprint asignado");

    // Y la cinta está presente.
    await esperarCinta();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("la cinta tiene una columna por sprint, en orden", async () => {
    stubApi();
    renderPagina();

    const cinta = await esperarCinta();
    const botones = within(cinta).getAllByRole("button");
    expect(botones.map((b) => b.getAttribute("title")?.split(",")[0])).toEqual([
      "Sprint 1",
      "Sprint 2",
      "Sprint 3",
    ]);
  });

  it("escala la altura contra el sprint más grande", async () => {
    stubApi();
    renderPagina();

    const cinta = await esperarCinta();
    const barras = within(cinta).getAllByRole("button");
    // Sprint 2 (40) es el mayor: 100%. Sprint 1 (12) ~30%, Sprint 3 (10) 25%.
    expect(barras[1]).toHaveStyle({ height: "100%" });
    expect(barras[0]).toHaveStyle({ height: "30%" });
    expect(barras[2]).toHaveStyle({ height: "25%" });
  });

  it("marca el rezago solo en los sprints históricos con deuda", async () => {
    stubApi();
    renderPagina();

    const cinta = await esperarCinta();
    const marcas = cinta.querySelectorAll(".cinta-rezago");
    // Sprint 1 y 2 son históricos y dejamos cosas abiertas. Sprint 3 es el
    // actual: lo que aún no cerró no es rezago.
    expect(marcas).toHaveLength(2);
  });

  it("marca el sprint actual con un tono propio y lo deja pulsable", async () => {
    stubApi();
    renderPagina();

    const cinta = await esperarCinta();
    const actual = within(cinta).getAllByRole("button")[2];
    expect(actual).toHaveAttribute("data-actual", "true");
    // Se puede filtrar por el actual: es el sprint que más se consulta.
    expect(actual).toBeEnabled();
  });

  it("la columna seleccionada queda marcada y no se puede volver a pulsar", async () => {
    stubApi();
    renderPagina({ filtros: { sprint: "Proyecto de ejemplo\\Sprint 1" } });

    const cinta = await esperarCinta();
    const activo = within(cinta).getAllByRole("button")[0];
    expect(activo).toHaveAttribute("data-activo", "true");
    expect(activo).toBeDisabled();
  });

  it("el tono de una columna histórica con deuda es alerta", async () => {
    stubApi();
    renderPagina();

    const cinta = await esperarCinta();
    const barras = within(cinta).getAllByRole("button");
    expect(barras[0]).toHaveAttribute("data-tono", "alerta"); // 4 sin cerrar
    expect(barras[1]).toHaveAttribute("data-tono", "alerta"); // 30 sin cerrar
  });

  it("el resumen bajo la cinta cuenta los sprints con trabajo sin cerrar", async () => {
    stubApi();
    renderPagina();

    await esperarCinta();
    expect(screen.getByText(/3 sprints/)).toBeInTheDocument();
    expect(screen.getByText(/Sprint 3 es el más reciente/)).toBeInTheDocument();
    expect(screen.getByText(/2 con trabajo sin cerrar/)).toBeInTheDocument();
  });

  it("no descarga ítems si no hay filtros", async () => {
    const mock = stubApi();
    renderPagina();

    await esperarCinta();
    await screen.findByText(/Elige un sprint en la cinta/);
    expect(peticionesItems(mock)).toBe(0);
  });

  it("invita a elegir sprint en vez de mostrar una lista vacía", async () => {
    stubApi();
    renderPagina();

    expect(
      await screen.findByText(/Elige un sprint en la cinta, una persona o un tipo/),
    ).toBeInTheDocument();
  });
});

describe("Selección en la cinta", () => {
  it("pulsa una columna y filtra por ese sprint", async () => {
    stubApi();
    renderPagina();

    const cinta = await esperarCinta();
    fireEvent.click(within(cinta).getAllByRole("button")[0]);

    await waitFor(() =>
      expect(window.location.hash).toContain("sprint="),
    );
    const [, query = ""] = window.location.hash.split("?");
    expect(new URLSearchParams(query).get("sprint")).toBe("Proyecto de ejemplo\\Sprint 1");
  });

  it("al elegir un sprint el veredicto pasa a hablar de ese sprint", async () => {
    stubApi();
    renderPagina({ filtros: { sprint: "Proyecto de ejemplo\\Sprint 2" } });

    const veredicto = await esperarVeredicto();
    expect(veredicto).toHaveTextContent("Sprint 2");
    expect(veredicto).toHaveTextContent("30 abiertos de 40 ítems");
    expect(veredicto).toHaveTextContent("25% cerrado");
    // Por debajo del 50% es alerta: es justo lo que la vista debe señalar.
    expect(veredicto).toHaveAttribute("data-tono", "alerta");
  });

  it("marca en la cinta el sprint que se está viendo", async () => {
    stubApi();
    renderPagina({ filtros: { sprint: "Proyecto de ejemplo\\Sprint 1" } });

    const cinta = await esperarCinta();
    const activo = cinta.querySelector('[data-activo="true"]');
    expect(activo).toHaveAttribute("data-tono");
    expect(activo?.getAttribute("title")).toContain("Sprint 1");
  });
});

describe("Nivel 2 · detalle bajo demanda", () => {
  it("con un filtro activo, los ítems aparecen sin pedir nada más", async () => {
    const mock = stubApi();
    renderPagina({ filtros: { tipo: "Bug" } });

    const fila = (await screen.findByRole("cell", { name: /Error de cálculo/ })).closest("tr");
    expect(fila).toBeTruthy();
    expect(peticionesItems(mock)).toBe(1);
  });

  it("con desplegado=1 se ven los ítems sin filtros", async () => {
    const mock = stubApi();
    renderPagina({ desplegado: true });

    expect(await screen.findByRole("cell", { name: /Error de cálculo/ })).toBeInTheDocument();
    expect(peticionesItems(mock)).toBe(1);
  });

  it("los ítems muestran sprint, responsable y antigüedad", async () => {
    stubApi();
    renderPagina({ filtros: { tipo: "Bug" } });

    const fila = (await screen.findByRole("cell", { name: /Error de cálculo/ })).closest(
      "tr",
    ) as HTMLElement;
    expect(within(fila).getByText("Ana Pérez")).toBeInTheDocument();
    expect(within(fila).getByText("Sprint 3")).toBeInTheDocument();
    expect(within(fila).getByText("verificado-qa")).toBeInTheDocument();
  });

  it("explica que no hay resultados en vez de mostrar una tabla vacía", async () => {
    stubApi({ ...ITEMS, items: [], total: 0, hay_mas: false });
    renderPagina({ filtros: { tipo: "Bug" } });

    expect(await screen.findByText("Ningún ítem cumple los filtros indicados.")).toBeInTheDocument();
  });
});

describe("Embudo de filtros", () => {
  it("sin filtros dice que no hay ninguno, sin pastillas vacías", async () => {
    stubApi();
    renderPagina();

    expect(
      await screen.findByText("Sin filtros: se ve todo el proyecto."),
    ).toBeInTheDocument();
  });

  it("cada filtro activo es una pastilla con su quitar", async () => {
    stubApi();
    renderPagina({ filtros: { tipo: "Bug", soloAbiertos: true } });

    const embudo = await screen.findByRole("list", { name: "Filtros activos" });
    expect(within(embudo).getByText(/Tipo: Bug/)).toBeInTheDocument();
    expect(within(embudo).getByText(/Solo abiertos/)).toBeInTheDocument();
  });

  it("el nombre del sprint en la pastilla es corto, no la ruta entera", async () => {
    stubApi();
    renderPagina({ filtros: { sprint: "Proyecto de ejemplo\\Sprint 45" } });

    const pastilla = await screen.findByTitle(/Quitar el filtro/);
    expect(pastilla).toHaveTextContent("Sprint Sprint 45");
    // La ruta larga no debe aparecer en pantalla.
    expect(pastilla.textContent).not.toContain("Proyecto de ejemplo");
  });

  it("quitar una pastilla quita solo ese filtro", async () => {
    stubApi();
    renderPagina({ filtros: { tipo: "Bug", soloAbiertos: true } });

    const embudo = await screen.findByRole("list", { name: "Filtros activos" });
    fireEvent.click(within(embudo).getByTitle(/Quitar el filtro «Tipo: Bug»/));

    await waitFor(() => {
      const [, query = ""] = window.location.hash.split("?");
      const params = new URLSearchParams(query);
      expect(params.get("tipo")).toBeNull();
      expect(params.get("soloAbiertos")).toBe("1");
    });
  });

  it("«Limpiar N» solo aparece con más de un filtro", async () => {
    stubApi();
    const { unmount } = renderPagina({ filtros: { tipo: "Bug" } });
    await esperarCinta();
    expect(screen.queryByRole("button", { name: /Limpiar \d/ })).toBeNull();
    unmount();

    renderPagina({ filtros: { tipo: "Bug", soloAbiertos: true } });
    expect(await screen.findByRole("button", { name: "Limpiar 2" })).toBeInTheDocument();
  });
});

describe("Estados de la vista", () => {
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
    renderPagina();

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
    renderPagina();

    expect(
      await screen.findByText(/No se pudo cargar el catálogo de sprints/),
    ).toBeInTheDocument();
  });
});
