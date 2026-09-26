import { describe, expect, it } from "vitest";

import { fechaCorta, antiguedadLegible, contarFiltros, diasDesde, porcentaje, porMasReciente, resumenFiltros } from "./fechas";
import type { MuestraItem, Sprint } from "../api/tipos";
import type { FiltrosSprint } from "../navegacion";

const AHORA = new Date("2026-09-26T12:00:00Z");

describe("fechas de la vista de sprints", () => {
  it("calcula los días transcurridos", () => {
    expect(diasDesde("2026-09-24T12:00:00Z", AHORA)).toBe(2);
    expect(diasDesde("2026-09-26T12:00:00Z", AHORA)).toBe(0);
  });

  it("devuelve null ante fecha ausente o corrupta", () => {
    expect(diasDesde(null)).toBeNull();
    expect(diasDesde("")).toBeNull();
    expect(diasDesde("no-es-fecha")).toBeNull();
  });

  it("usa días relativos legibles y no negativos", () => {
    expect(antiguedadLegible("2026-09-26T12:00:00Z", AHORA)).toBe("hoy");
    expect(antiguedadLegible("2026-09-25T12:00:00Z", AHORA)).toBe("hace 1 día");
    expect(antiguedadLegible("2026-09-22T12:00:00Z", AHORA)).toBe("hace 4 días");
    expect(antiguedadLegible("2026-09-01T12:00:00Z", AHORA)).toBe("hace 3 semanas");
    expect(antiguedadLegible("2026-06-01T12:00:00Z", AHORA)).toBe("hace 3 meses");
    expect(antiguedadLegible("2024-06-01T12:00:00Z", AHORA)).toBe("hace 2 años");
    expect(antiguedadLegible(null, AHORA)).toBe("—");
  });

  it("formatea fechas cortas en dd/mm/aaaa", () => {
    expect(fechaCorta("2026-09-26T10:00:00")).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(fechaCorta("")).toBe("—");
    expect(fechaCorta("basura")).toBe("—");
  });
});

describe("porcentajes", () => {
  it("redondea la parte sobre el total", () => {
    expect(porcentaje(1, 3)).toBe(33);
    expect(porcentaje(2, 4)).toBe(50);
  });

  it("devuelve 0 en vez de NaN cuando el total es 0", () => {
    // NaN en un style o en un ancho de barra rompe el render en silencio.
    expect(porcentaje(0, 0)).toBe(0);
    expect(porcentaje(5, 0)).toBe(0);
  });
});

describe("resumen de filtros", () => {
  const sprints: Sprint[] = [
    { nombre: "Sprint 1", ruta: "P\\Sprint 1", total: 3, abiertos: 1, cerrados: 2, personas: 2, ultimo_cambio: "" },
    { nombre: "Sprint 45", ruta: "P\\Sprint 45", total: 9, abiertos: 6, cerrados: 3, personas: 4, ultimo_cambio: "" },
  ];

  it("usa el nombre corto del sprint, no la ruta completa", () => {
    expect(resumenFiltros({ sprint: "P\\Sprint 45" }, sprints)).toBe("sprint Sprint 45");
  });

  it("cae al nombre de persona si no conoce el GUID", () => {
    expect(resumenFiltros({ persona: "g-1" }, sprints, { "g-1": "Ana Pérez" })).toBe(
      "persona Ana Pérez",
    );
    expect(resumenFiltros({ persona: "g-9" }, sprints, { "g-1": "Ana" })).toBe("persona g-9");
  });

  it("combina varios filtros y omite los vacíos", () => {
    expect(
      resumenFiltros(
        { sprint: "P\\Sprint 45", persona: "g-1", tipo: "Bug", soloAbiertos: true },
        sprints,
        { "g-1": "Ana" },
      ),
    ).toBe("sprint Sprint 45 · persona Ana · tipo Bug · solo abiertos");
  });

  it("distingue «sin filtros» de un filtro vacío", () => {
    expect(resumenFiltros({}, sprints)).toBe("Sin filtros");
    expect(resumenFiltros({ sprint: "" }, sprints)).toBe("Sin filtros");
  });
});

describe("conteo de filtros", () => {
  it("cuenta solo los activos", () => {
    expect(contarFiltros({})).toBe(0);
    expect(contarFiltros({ sprint: "", persona: undefined })).toBe(0);
    expect(contarFiltros({ soloAbiertos: false })).toBe(0);
    expect(contarFiltros({ sprint: "P\\S1" } as FiltrosSprint)).toBe(1);
    expect(contarFiltros({ sprint: "P\\S1", tipo: "Bug", soloAbiertos: true })).toBe(3);
  });
});

describe("orden de las muestras", () => {
  const item = (id: number, modificado: string): MuestraItem => ({
    azure_id: id,
    tipo: "Bug",
    titulo: `Bug ${id}`,
    estado: "Active",
    sprint: "Sprint 1",
    persona: "Ana",
    modificado,
  });

  it("ordena por fecha descendente", () => {
    const lista = [item(1, "2026-09-01T00:00:00Z"), item(2, "2026-09-20T00:00:00Z")];
    expect([...lista].sort(porMasReciente).map((i) => i.azure_id)).toEqual([2, 1]);
  });

  it("desempata por id descendente cuando la fecha coincide", () => {
    const lista = [
      item(1, "2026-09-20T00:00:00Z"),
      item(5, "2026-09-20T00:00:00Z"),
      item(3, "2026-09-20T00:00:00Z"),
    ];
    expect([...lista].sort(porMasReciente).map((i) => i.azure_id)).toEqual([5, 3, 1]);
  });

  it("no rompe cuando falta la fecha", () => {
    const lista = [item(1, ""), item(2, "2026-09-20T00:00:00Z")];
    expect([...lista].sort(porMasReciente).map((i) => i.azure_id)).toEqual([2, 1]);
  });
});
