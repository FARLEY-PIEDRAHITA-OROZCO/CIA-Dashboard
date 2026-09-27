/** Pruebas del filtro de épicas por responsable de pruebas.
 *
 * Lo que se vigila es que el filtro sea **local** (no genere peticiones) y que
 * no dependa de `incluirCerradas`: buscar «las épicas de Ana» tiene que
 * encontrar las suyas aunque estén cerradas, o parecería que no tiene ninguna.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVista } from "../navegacion";
import Dashboard from "./Dashboard";

const EPICAS = {
  epicas: [
    { azure_id: 1, titulo: "Una", estado: "Active" },
    { azure_id: 2, titulo: "Dos", estado: "Closed" },
    { azure_id: 3, titulo: "Tres", estado: "Active" },
    // Sin nadie asignado: es la que debe decir «sin asignar».
    { azure_id: 4, titulo: "Cuatro", estado: "New" },
  ],
};

const PERSONAS = {
  personas: [
    {
      guid: "g-ana",
      nombre: "Ana Diaz",
      es_qa: true,
      es_dev: false,
      forzado: true,
      epicas: 2,
      epicas_qa: 2,
      epicas_dev: 0,
      mas_antigua: "2026-09-01",
      dias_laborables: 18,
      items_backlog: 12,
      bugs: 1,
    },
    {
      guid: "g-luis",
      nombre: "Luis Ruiz",
      es_qa: false,
      es_dev: true,
      forzado: false,
      epicas: 1,
      epicas_qa: 0,
      epicas_dev: 1,
      mas_antigua: "2026-09-20",
      dias_laborables: 4,
      items_backlog: 3,
      bugs: 0,
    },
  ],
  total: 2,
  qa: 1,
  dev: 1,
  sin_rol: 0,
};

const ASIGNACIONES = {
  asignaciones: [
    {
      epica: 1,
      titulo: "Una",
      titulo_conocido: true,
      persona: "g-ana",
      nombre_persona: "Ana Diaz",
      rol: "qa",
      desde: "2026-09-01",
      dias_laborables: 18,
      nota: "",
    },
    {
      // Épica **cerrada**: tiene que aparecer igual con el filtro puesto.
      epica: 2,
      titulo: "Dos",
      titulo_conocido: true,
      persona: "g-ana",
      nombre_persona: "Ana Diaz",
      rol: "qa",
      desde: "2026-09-01",
      dias_laborables: 18,
      nota: "",
    },
    {
      epica: 3,
      titulo: "Tres",
      titulo_conocido: true,
      persona: "g-luis",
      nombre_persona: "Luis Ruiz",
      rol: "dev",
      desde: "2026-09-20",
      dias_laborables: 4,
      nota: "",
    },
  ],
  total: 3,
  epicas_desconocidas: 0,
};

let pedidas: string[];

function montar() {
  pedidas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      pedidas.push(url);
      let cuerpo: unknown = { configurada: true, verificado: true };
      if (url.includes("/api/epics")) cuerpo = EPICAS;
      else if (url.includes("/api/qa/personas")) cuerpo = PERSONAS;
      else if (url.includes("/api/qa/asignaciones")) cuerpo = ASIGNACIONES;
      return new Response(JSON.stringify(cuerpo), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <Vista />
    </QueryClientProvider>,
  );
}

/** Lee el hash como `App`, para que el filtro viaje por la URL de verdad. */
function Vista() {
  const vista = useVista();
  if (vista.pagina !== "dashboard") return <p>fuera</p>;
  return <Dashboard filtro={vista.filtro} />;
}

function tabla() {
  return screen.getByRole("table");
}

function filas() {
  return within(tabla())
    .getAllByRole("row")
    .slice(1)
    .map((f) => f.textContent ?? "");
}

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
});

describe("filtro por responsable de pruebas", () => {
  it("sin filtro muestra todas las épicas", async () => {
    montar();
    await screen.findByText("Una");
    expect(filas()).toHaveLength(4);
  });

  it("el desplegable solo ofrece a quienes tienen épicas", async () => {
    montar();
    await screen.findByText("Una");
    const opciones = within(screen.getByLabelText(/Épicas de/i))
      .getAllByRole("option")
      .map((o) => o.textContent);
    // Ordenadas por volumen: quien más lleva primero.
    expect(opciones[0]).toContain("Todas");
    expect(opciones[1]).toContain("Ana Diaz (2)");
    expect(opciones[2]).toContain("Luis Ruiz (1)");
  });

  it("al elegir a alguien filtra la tabla y lo dice en el KPI", async () => {
    montar();
    await screen.findByText("Una");

    fireEvent.change(screen.getByLabelText(/Épicas de/i), {
      target: { value: "g-ana" },
    });

    await waitFor(() => {
      expect(screen.getByText(/Épicas de Ana Diaz/)).toBeTruthy();
    });
    expect(filas()).toHaveLength(2);
    expect(tabla().textContent).toContain("Dos");
    expect(tabla().textContent).not.toContain("Tres");
  });

  it("el filtro no depende de «incluir cerradas»", async () => {
    // Es el fallo sutil: «Dos» está Closed y `listar_epicas` la excluye, así
    // que con el filtro puesto se perdería y parecería que Ana no la tiene.
    montar();
    window.location.hash = "#/dashboard?qa=g-ana";
    await screen.findByText("Una");
    expect(filas()).toHaveLength(2);
    expect(tabla().textContent).toContain("Dos");
  });

  it("el filtro viaja en el hash, para poder compartirlo", async () => {
    montar();
    await screen.findByText("Una");
    fireEvent.change(screen.getByLabelText(/Épicas de/i), {
      target: { value: "g-luis" },
    });
    await waitFor(() => {
      expect(window.location.hash).toContain("qa=g-luis");
    });
  });

  it("se puede quitar el filtro", async () => {
    montar();
    window.location.hash = "#/dashboard?qa=g-ana";
    await screen.findByText("Una");
    expect(filas()).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /Quitar filtro/ }));
    await waitFor(() => {
      expect(filas()).toHaveLength(4);
    });
    expect(window.location.hash).not.toContain("qa=");
  });

  it("filtrar no genera peticiones: la lista ya está en memoria", async () => {
    montar();
    await screen.findByText("Una");
    const antes = pedidas.length;

    fireEvent.change(screen.getByLabelText(/Épicas de/i), {
      target: { value: "g-ana" },
    });
    await waitFor(() => {
      expect(filas()).toHaveLength(2);
    });
    expect(pedidas).toHaveLength(antes);
  });
});

describe("responsables en la tabla de épicas", () => {
  it("cada fila muestra quién lleva sus pruebas", async () => {
    montar();
    await screen.findByText("Una");
    const conAna = filas().find((f) => f.includes("Una")) ?? "";
    expect(conAna).toContain("Ana Diaz");
  });

  it("una épica sin asignar lo dice, en vez de dejar la celda vacía", async () => {
    // Una celda vacía se lee como «no hemos mirado».
    montar();
    await screen.findByText("Una");
    expect(tabla().textContent).toContain("sin asignar");
  });

  it("la cabecera nombra la columna nueva", async () => {
    montar();
    await screen.findByText("Una");
    expect(within(tabla()).getByRole("columnheader", { name: "Pruebas" })).toBeTruthy();
  });
});
