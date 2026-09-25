import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Dashboard from "./Dashboard";

const ESTADO = {
  configurada: true,
  organizacion: "https://dev.azure.com/org",
  proyecto: "Proyecto de ejemplo",
  area_path: "Proyecto de ejemplo",
  verificado: true,
  error: "",
};

const EPICAS = {
  epicas: [
    { azure_id: 1, titulo: "Una", estado: "Active", url: "" },
    { azure_id: 2, titulo: "Dos", estado: "Doing", url: "" },
    { azure_id: 3, titulo: "Tres", estado: "Resolved", url: "" },
  ],
};

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Dashboard", () => {
  it("usa tonos normalizados para los KPIs de progreso y terminadas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: RequestInfo | URL) => {
        const url = String(entrada);
        const cuerpo = url.includes("/epics") ? EPICAS : ESTADO;
        return new Response(JSON.stringify(cuerpo), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    renderDashboard();

    const progreso = await screen.findByText("En progreso");
    const terminadas = await screen.findByText("Terminadas");
    expect(progreso.closest(".kpi")?.querySelector(".kpi-valor")).toHaveTextContent("2");
    expect(terminadas.closest(".kpi")?.querySelector(".kpi-valor")).toHaveTextContent("1");
  });

  it("muestra carga mientras se solicita el listado configurado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((entrada: RequestInfo | URL) => {
        const url = String(entrada);
        if (url.includes("/epics")) {
          return new Promise<Response>(() => undefined);
        }
        return Promise.resolve(
          new Response(JSON.stringify(ESTADO), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }),
    );

    renderDashboard();

    expect(await screen.findByText("Cargando épicas…")).toBeInTheDocument();
  });
});
