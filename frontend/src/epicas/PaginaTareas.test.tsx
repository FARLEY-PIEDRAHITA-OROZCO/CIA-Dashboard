import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Epic } from "../api/tipos";
import { PaginaTareas } from "./PaginaTareas";

const ARBOL: Epic = {
  azure_id: 100,
  titulo: "Canal digital",
  estado: "In Progress",
  descripcion: "Descripción",
  url: "https://dev.azure.com/org/proyecto/_workitems/edit/100",
  features: [
    {
      azure_id: 101,
      titulo: "Onboarding",
      estado: "New",
      descripcion: "",
      hus: [
        {
          azure_id: 201,
          titulo: "HU Registro",
          estado: "New",
          descripcion: "",
          tareas: [
            {
              azure_id: 301,
              titulo: "Crear formulario",
              estado: "New",
              descripcion: "<p>Detalle</p>",
              url: "https://dev.azure.com/org/proyecto/_workitems/edit/301",
            },
          ],
        },
      ],
    },
  ],
  hus: [],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(ARBOL), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PaginaTareas", () => {
  it("carga el árbol y muestra el tablero de tareas", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <PaginaTareas azureId={100} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Crear formulario")).toBeInTheDocument();
    expect(screen.getByText(/1 tarea del backlog/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /volver a historias/i })).toHaveAttribute(
      "href",
      "#/epicas/100",
    );
  });
});
