import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "./cliente";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cliente API", () => {
  it("rechaza respuestas JSON que no cumplen el contrato", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(api.epicas()).rejects.toBeInstanceOf(ApiError);
  });

  it("valida el payload de bugs y sus métricas", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          bugs: [
            {
              azure_id: 10,
              titulo: "Bug",
              estado: "Active",
              descripcion: "",
              prioridad: "1",
              severidad: "Critical",
              asignado_a: "",
              relacion: "hierarchy",
              tareas: [],
            },
          ],
          metricas: {
            total: 1,
            abiertos: 1,
            cerrados: 0,
            por_estado: {},
            por_prioridad: {},
            por_severidad: {},
            por_relacion: {},
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const detalle = await api.bugsEpica(100);

    expect(detalle.bugs[0].titulo).toBe("Bug");
    expect(detalle.metricas.total).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/epics/100/bugs?incluir_cerradas=false",
      expect.any(Object),
    );
  });

  it("propaga la señal de cancelación al fetch", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ epicas: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.epicas(false, controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/epics?incluir_cerradas=false",
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
