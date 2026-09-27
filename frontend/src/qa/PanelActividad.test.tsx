/** Pruebas del panel de actividad.
 *
 * La prueba que más importa aquí es la primera: **no se pide nada hasta que
 * alguien abre el panel**. Es la petición más cara de la aplicación —una llamada
 * a Azure por ítem del árbol, hasta 254 en una épica grande— así que montar el
 * panel al abrir la ficha de una épica haría que cada visita costara cientos de
 * llamadas que nadie pidió.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PanelActividad } from "./PanelActividad";

const ACTIVIDAD = {
  epica: 5716,
  titulo: "Buzón de requerimientos",
  items_analizados: 232,
  items_totales: 232,
  parcial: false,
  items_sin_actividad: 2,
  revisiones: 1938,
  personas: 3,
  primera: "2024-10-21T20:01:41Z",
  ultima: "2026-08-05T19:59:29Z",
  por_persona: [
    { guid: "g-brian", nombre: "Brian Ferney", revisiones: 629 },
    { guid: "g-leider", nombre: "Leider Vaquiro", revisiones: 467 },
    { guid: "g-farley", nombre: "Farley Piedrahita", revisiones: 354 },
  ],
  por_tipo: { Task: 191, "User Story": 35, Feature: 5, Epic: 1 },
  nota: "Actividad registrada = número de revisiones, no horas.",
};

let pedidas: string[];

function montar() {
  pedidas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      pedidas.push(String(entrada));
      return new Response(JSON.stringify(ACTIVIDAD), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <PanelActividad epica={5716} titulo="Buzón de requerimientos" />
    </QueryClientProvider>,
  );
}

const abrir = () => fireEvent.click(screen.getByRole("button", { name: /Ver actividad/ }));

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
});

describe("panel de actividad", () => {
  it("cerrado no pide nada", () => {
    montar();
    // La garantía de coste: montar el panel no cuesta ni una llamada.
    expect(pedidas).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Ver actividad/ })).toBeTruthy();
  });

  it("el botón cerrado avisa de que no son horas", () => {
    montar();
    expect(screen.getByText(/No son horas/i)).toBeTruthy();
  });

  it("al abrirlo pide la actividad de esa épica", async () => {
    montar();
    abrir();
    await waitFor(() => {
      expect(pedidas).toHaveLength(1);
    });
    expect(pedidas[0]).toContain("/api/qa/epicas/5716/actividad");
  });

  it("muestra revisiones, personas y rango de fechas", async () => {
    montar();
    abrir();
    await screen.findByText("1938");
    expect(screen.getByText("Revisiones")).toBeTruthy();
    expect(screen.getByText("21 oct 2024 → 5 ago 2026")).toBeTruthy();
  });

  it("cada persona enlaza al filtro del dashboard por su GUID", async () => {
    montar();
    abrir();
    const enlace = await screen.findByRole("button", { name: "Brian Ferney" });
    fireEvent.click(enlace);
    await waitFor(() => {
      expect(window.location.hash).toBe("#/dashboard?qa=g-brian");
    });
  });

  it("dice cuántos ítems están sin tocar desde que se crearon", async () => {
    montar();
    abrir();
    await screen.findByText("1938");
    expect(screen.getByText(/2 de 232 ítems/)).toBeTruthy();
  });

  it("el reparto por tipo ordena por volumen", async () => {
    montar();
    abrir();
    await screen.findByText("1938");
    const filas = screen
      .getAllByText(/^(Task|User Story|Feature|Epic)$/)
      .map((e) => e.textContent);
    expect(filas[0]).toBe("Task");
  });

  it("no separa QA de dev, porque la actividad no lo sabe", async () => {
    // Cruzar el rol declarado en el registro con «tocó el ítem» sería un reparto
    // que parece medido y en realidad mezcla dos fuentes distintas.
    montar();
    abrir();
    await screen.findByText("1938");
    expect(screen.queryByText(/equipo de QA/i)).toBeNull();
    expect(screen.queryByText(/equipo de desarrollo/i)).toBeNull();
  });

  it("trae la nota de límites con el dato", async () => {
    montar();
    abrir();
    await screen.findByText("1938");
    expect(screen.getByText(/no horas/i)).toBeTruthy();
  });

  it("se puede volver a cerrar sin volver a pedir", async () => {
    montar();
    abrir();
    await screen.findByText("1938");
    fireEvent.click(screen.getByRole("button", { name: "Ocultar" }));
    expect(screen.getByRole("button", { name: /Ver actividad/ })).toBeTruthy();
    expect(pedidas).toHaveLength(1);
  });
});

describe("panel de actividad: lecturas incompletas", () => {
  it("una lectura parcial dice que el número es una cota inferior", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...ACTIVIDAD,
              parcial: true,
              items_analizados: 180,
              items_totales: 232,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <PanelActividad epica={5716} titulo="É" />
      </QueryClientProvider>,
    );
    abrir();
    await screen.findByText("1938");
    expect(screen.getByText(/52 de 232 ítems/)).toBeTruthy();
    expect(screen.getByText(/cota inferior/)).toBeTruthy();
  });

  it("un error se dice, no se traga en un panel vacío", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "no se pudo leer" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <PanelActividad epica={5716} titulo="É" />
      </QueryClientProvider>,
    );
    abrir();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("una épica sin ninguna fecha no muestra un rango vacío", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...ACTIVIDAD,
              revisiones: 0,
              personas: 0,
              por_persona: [],
              por_tipo: {},
              items_sin_actividad: 232,
              primera: "",
              ultima: "",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <PanelActividad epica={5716} titulo="É" />
      </QueryClientProvider>,
    );
    abrir();
    await waitFor(() => {
      expect(screen.getByText(/sin fechas registradas/)).toBeTruthy();
    });
    // 0 personas no deja una lista vacía con encabezado y nada debajo.
    expect(screen.queryByText("Quién ha tocado la épica")).toBeNull();
  });
});
