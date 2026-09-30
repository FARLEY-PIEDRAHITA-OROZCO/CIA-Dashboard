/** Pruebas de la página del monitor de Azure. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import PaginaMonitor from "./PaginaMonitor";
import { api } from "../api/cliente";

vi.mock("../api/cliente", () => ({
  api: {
    monitorAzure: vi.fn(),
  },
}));

function renderConProvider() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PaginaMonitor />
    </QueryClientProvider>
  );
}

describe("PaginaMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("muestra cargando al principio", () => {
    vi.mocked(api.monitorAzure).mockReturnValue(new Promise(() => {}));
    renderConProvider();
    expect(screen.getByText(/cargando monitor/i)).toBeTruthy();
  });

  it("muestra error cuando el endpoint falla", async () => {
    vi.mocked(api.monitorAzure).mockRejectedValue(new Error("HTTP 404"));
    renderConProvider();
    await waitFor(() => {
      expect(screen.getByText(/http 404/i)).toBeTruthy();
    });
  });

  it("muestra KPIs cuando hay datos", async () => {
    vi.mocked(api.monitorAzure).mockResolvedValue({
      activa: true,
      total: 42,
      errores: 3,
      tasaError: 0.071,
      latenciaP50Ms: 250,
      latenciaP95Ms: 1200,
      latenciaMaxMs: 3400,
      concurrentes: 0,
      concurrentesPico: 0,
      limiteConcurrentes: 300,
      porCategoria: { "wit/wiql": 20, "wit/workitems": 22 },
      porEstado: {},
      llamadasRecientes: [
        {
          hora: "2026-09-29T12:34:56.000Z",
          metodo: "POST",
          categoria: "wit/wiql",
          estado: 200,
          duracionMs: 350,
          error: "",
        },
      ],
      avisos: [],
    });
    renderConProvider();
    await waitFor(() => {
      expect(screen.getByText("42")).toBeTruthy();
      expect(screen.getByText("3")).toBeTruthy();
    });
  });

  it("muestra tabla de llamadas recientes cuando hay datos", async () => {
    vi.mocked(api.monitorAzure).mockResolvedValue({
      activa: true,
      total: 1,
      errores: 0,
      tasaError: 0,
      latenciaP50Ms: 100,
      latenciaP95Ms: 100,
      latenciaMaxMs: 100,
      concurrentes: 0,
      concurrentesPico: 0,
      limiteConcurrentes: 300,
      porCategoria: { "wit/wiql": 1 },
      porEstado: {},
      llamadasRecientes: [
        {
          hora: "2026-09-29T10:00:00.000Z",
          metodo: "GET",
          categoria: "wit/wiql",
          estado: 200,
          duracionMs: 150,
          error: "",
        },
      ],
      avisos: [],
    });
    renderConProvider();
    await waitFor(() => {
      expect(screen.getAllByText("wit/wiql").length).toBeGreaterThan(0);
      expect(screen.getByText("150 ms")).toBeTruthy();
    });
  });

  it("muestra mensaje cuando no hay llamadas", async () => {
    vi.mocked(api.monitorAzure).mockResolvedValue({
      activa: true,
      total: 0,
      errores: 0,
      tasaError: 0,
      latenciaP50Ms: 0,
      latenciaP95Ms: 0,
      latenciaMaxMs: 0,
      concurrentes: 0,
      concurrentesPico: 0,
      limiteConcurrentes: 300,
      porCategoria: {},
      porEstado: {},
      llamadasRecientes: [],
      avisos: [],
    });
    renderConProvider();
    await waitFor(() => {
      expect(screen.getByText(/sin llamadas registradas/i)).toBeTruthy();
    });
  });
});
