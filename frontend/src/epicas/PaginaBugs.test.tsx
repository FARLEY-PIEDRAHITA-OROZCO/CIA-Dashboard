import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PaginaBugs } from "./PaginaBugs";

const DETALLE = {
  bugs: [
    {
      azure_id: 10,
      titulo: "Error de validación",
      estado: "Active",
      descripcion: "",
      prioridad: "1",
      severidad: "Critical",
      asignado_a: "Persona",
      relacion: "hierarchy",
      tareas: [],
    },
  ],
  metricas: {
    total: 1,
    abiertos: 1,
    cerrados: 0,
    por_estado: { Active: 1 },
    por_prioridad: { "1": 1 },
    por_severidad: { Critical: 1 },
    por_relacion: { hierarchy: 1 },
  },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(DETALLE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PaginaBugs", () => {
  it("carga métricas y muestra el tablero", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <PaginaBugs azureId={100} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Bugs de la épica")).toBeInTheDocument();
    expect(await screen.findByText("Error de validación")).toBeInTheDocument();
    expect(screen.getByText("Bugs totales")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /volver a historias/i })).toHaveAttribute(
      "href",
      "#/epicas/100",
    );
  });
});
