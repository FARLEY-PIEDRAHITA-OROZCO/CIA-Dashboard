import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Epic } from "../api/tipos";
import { PaginaEpica } from "./PaginaEpica";

const ARBOL: Epic = {
  azure_id: 100,
  titulo: "Canal digital",
  estado: "In Progress",
  descripcion: "Descripción de la épica",
  url: "https://dev.azure.com/organizacion-ejemplo/Proyecto-de-ejemplo/_workitems/edit/100",
  hus: [{ azure_id: 300, titulo: "Directa", estado: "New", descripcion: "" }],
  features: [
    {
      azure_id: 101,
      titulo: "Onboarding",
      estado: "Committed",
      descripcion: "",
      hus: [
        {
          azure_id: 201,
          titulo: "HU Registro",
          estado: "New",
          descripcion: "",
          tareas: [{ azure_id: 301, titulo: "Tarea de registro", estado: "New", descripcion: "" }],
        },
        { azure_id: 202, titulo: "HU Validación", estado: "Done", descripcion: "" },
      ],
    },
  ],
};

const encabezados = { "Content-Type": "application/json" };

function renderPagina() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaginaEpica azureId={100} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(ARBOL), {
        status: 200,
        headers: encabezados,
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PaginaEpica", () => {
  it("carga y muestra la cabecera, features y tablero de historias", async () => {
    renderPagina();

    expect(await screen.findByText("Canal digital")).toBeInTheDocument();
    expect(screen.getByText("Épica #100")).toBeInTheDocument();
    expect((await screen.findAllByText("Onboarding")).length).toBeGreaterThan(0);

    expect(screen.getByText("HU Registro")).toBeInTheDocument();
    expect(screen.getByText("HU Validación")).toBeInTheDocument();
    expect(screen.getByText("Directa")).toBeInTheDocument();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("ofrece volver al backlog y abrir la épica en Azure", async () => {
    renderPagina();

    await screen.findByText("Canal digital");

    const volver = screen.getByRole("link", { name: /volver al backlog/i });
    expect(volver).toHaveAttribute("href", "#/dashboard");

    const azure = screen.getByRole("link", { name: /abrir en azure/i });
    expect(azure).toHaveAttribute("href", ARBOL.url);

    const tareas = screen.getByRole("link", { name: /ver tareas \(1\)/i });
    expect(tareas).toHaveAttribute("href", "#/epicas/100/tareas");
  });
});