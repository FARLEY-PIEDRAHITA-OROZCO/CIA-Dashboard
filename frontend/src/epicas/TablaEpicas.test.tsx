import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Epic, EpicResumen } from "../api/tipos";
import { TablaEpicas } from "./TablaEpicas";

const EPICAS: EpicResumen[] = [
  { azure_id: 100, titulo: "Canal digital", estado: "In Progress", url: "" },
  { azure_id: 200, titulo: "Inteligencia artificial", estado: "New", url: "" },
];

const ARBOL: Epic = {
  azure_id: 100,
  titulo: "Canal digital",
  estado: "In Progress",
  descripcion: "Descripción de la épica",
  url: "",
  hus: [],
  features: [
    {
      azure_id: 101,
      titulo: "Onboarding",
      estado: "Committed",
      descripcion: "",
      hus: [
        { azure_id: 201, titulo: "HU Registro", estado: "Done", descripcion: "" },
      ],
    },
  ],
};

const encabezados = { "Content-Type": "application/json" };

function renderTabla() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Envoltura() {
    const [abiertas, setAbiertas] = useState<ReadonlySet<number>>(new Set());
    return (
      <QueryClientProvider client={queryClient}>
        <TablaEpicas
          epicas={EPICAS}
          expandidas={abiertas}
          onAlternar={(id) =>
            setAbiertas((prev) => {
              const siguiente = new Set(prev);
              if (siguiente.has(id)) {
                siguiente.delete(id);
              } else {
                siguiente.add(id);
              }
              return siguiente;
            })
          }
        />
      </QueryClientProvider>
    );
  }

  return render(<Envoltura />);
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.includes("/arbol")) {
        return new Response(JSON.stringify(ARBOL), {
          status: 200,
          headers: encabezados,
        });
      }
      // La fila expandida monta además el panel de responsables, que lee el
      // registro local. Un stub que solo responde al árbol devuelve un 404 a
      // esas rutas y la prueba acaba comprobando otra cosa.
      if (url.includes("/api/qa/personas")) {
        return new Response(
          JSON.stringify({ personas: [], total: 0, qa: 0, dev: 0, sin_rol: 0 }),
          { status: 200, headers: encabezados },
        );
      }
      if (url.includes("/api/qa/asignaciones")) {
        return new Response(
          JSON.stringify({ asignaciones: [], total: 0, epicas_desconocidas: 0 }),
          { status: 200, headers: encabezados },
        );
      }
      return new Response('{"detail":"no encontrado"}', {
        status: 404,
        headers: encabezados,
      });
    }),
  );
});

/** Peticiones al árbol de Azure, que es lo que esta prueba vigila.
 *
 * No se cuenta el total de `fetch`: la fila expandida carga además el registro
 * local, y eso es lo correcto. Lo que no debe pasar es que expandir pida el
 * árbol más de una vez.
 */
function peticionesArbol(): number {
  const mock = fetch as unknown as { mock: { calls: unknown[][] } };
  return mock.mock.calls.filter((c) => String(c[0]).includes("/arbol")).length;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TablaEpicas", () => {
  it("lista las épicas del backlog", () => {
    renderTabla();
    expect(screen.getByText("Canal digital")).toBeInTheDocument();
    expect(screen.getByText("Inteligencia artificial")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
  });

  it("expande una épica y muestra sus features y el acceso a las historias", async () => {
    renderTabla();

    fireEvent.click(screen.getByRole("button", { name: /expandir épica canal digital/i }));

    expect(await screen.findByText("Onboarding")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /ver historias de usuario \(1\)/i }),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalled();
    expect(peticionesArbol()).toBe(1);
  });

  it("contrae una épica expandida", async () => {
    renderTabla();

    fireEvent.click(screen.getByRole("button", { name: /expandir épica canal digital/i }));
    expect(await screen.findByText("Onboarding")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /contraer épica canal digital/i }));
    expect(screen.queryByText("Onboarding")).not.toBeInTheDocument();
  });
});