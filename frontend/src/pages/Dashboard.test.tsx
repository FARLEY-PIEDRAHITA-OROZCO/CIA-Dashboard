import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
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

/** Stub de fetch que sirve el estado y el listado de épicas. */
function stubApi() {
  const mock = vi.fn(async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    const cuerpo = url.includes("/epics") ? EPICAS : ESTADO;
    return new Response(JSON.stringify(cuerpo), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

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

describe("Buscador de épicas", () => {
  it("filtra la tabla por título sin pedir más datos a Azure", async () => {
    const mock = stubApi();
    renderDashboard();
    await screen.findByText("Una");

    fireEvent.change(screen.getByLabelText(/buscar épica/i), {
      target: { value: "tres" },
    });

    expect(screen.getByText("Tres")).toBeInTheDocument();
    expect(screen.queryByText("Una")).not.toBeInTheDocument();
    expect(screen.queryByText("Dos")).not.toBeInTheDocument();
    // El filtrado es local: ninguna petición adicional.
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("busca por ID de Azure", async () => {
    stubApi();
    renderDashboard();
    await screen.findByText("Una");

    fireEvent.change(screen.getByLabelText(/buscar épica/i), {
      target: { value: "2" },
    });

    expect(screen.getByText("Dos")).toBeInTheDocument();
    expect(screen.queryByText("Una")).not.toBeInTheDocument();
  });

  it("resalta la coincidencia en la fila", async () => {
    stubApi();
    renderDashboard();
    await screen.findByText("Una");

    fireEvent.change(screen.getByLabelText(/buscar épica/i), {
      target: { value: "tres" },
    });

    const marca = document.querySelector("table mark");
    expect(marca).toHaveTextContent("Tres");
  });

  it("muestra un aviso cuando nada coincide", async () => {
    stubApi();
    renderDashboard();
    await screen.findByText("Una");

    fireEvent.change(screen.getByLabelText(/buscar épica/i), {
      target: { value: "inexistente" },
    });

    expect(screen.getByText(/Ninguna épica coincide/i)).toBeInTheDocument();
    expect(screen.queryByText("Una")).not.toBeInTheDocument();
  });

  it("anuncia cuántas épicas quedan y se limpia con el botón", async () => {
    stubApi();
    renderDashboard();
    await screen.findByText("Una");

    const campo = screen.getByLabelText(/buscar épica/i);
    expect(screen.getByText("3 épicas")).toBeInTheDocument();

    fireEvent.change(campo, { target: { value: "d" } });
    expect(screen.getByText("2 de 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /limpiar la búsqueda/i }));
    expect(campo).toHaveValue("");
    expect(screen.getByText("3 épicas")).toBeInTheDocument();
  });

  it("Escape limpia el campo", async () => {
    stubApi();
    renderDashboard();
    await screen.findByText("Una");

    const campo = screen.getByLabelText(/buscar épica/i);
    fireEvent.change(campo, { target: { value: "dos" } });
    fireEvent.keyDown(campo, { key: "Escape" });

    expect(campo).toHaveValue("");
    expect(screen.getByText("Una")).toBeInTheDocument();
  });
});
