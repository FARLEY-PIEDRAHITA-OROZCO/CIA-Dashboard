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
