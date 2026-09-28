import { act, render, screen } from "@testing-library/react";

import { describe, expect, it } from "vitest";

import {
  contarFiltros,
  enlaceA,
  filtrosAQuery,
  hojaAOffset,
  hojaPruebasAOffset,
  irA,
  parsearHash,
  totalHojas,
  totalHojasPruebas,
  useVista,
} from "./navegacion";

function SondaVista() {
  const vista = useVista();
  const texto =
    vista.pagina === "epica"
      ? `epica:${vista.azureId}`
      : vista.pagina === "sprints"
        ? `sprints:${vista.filtros.tipo ?? "-"}`
        : vista.pagina;
  return <div data-testid="vista">{texto}</div>;
}

describe("parsearHash", () => {
  it("mapea rutas de la página de historias", () => {
    expect(parsearHash("#/epicas/5586")).toEqual({ pagina: "epica", azureId: 5586 });
    expect(parsearHash("#/epicas/1")).toEqual({ pagina: "epica", azureId: 1 });
    expect(parsearHash("#/epicas/1/tareas")).toEqual({
      pagina: "epicaTareas",
      azureId: 1,
    });
    expect(parsearHash("#/epicas/1/bugs")).toEqual({
      pagina: "epicaBugs",
      azureId: 1,
    });
  });

  it("degrada a dashboard para rutas vacías o inválidas", () => {
    expect(parsearHash("")).toEqual({ pagina: "dashboard", filtro: {} });
    expect(parsearHash("#/dashboard")).toEqual({ pagina: "dashboard", filtro: {} });
    expect(parsearHash("#/epicas/abc")).toEqual({ pagina: "dashboard", filtro: {} });
    expect(parsearHash("#/epicas/1e3")).toEqual({ pagina: "dashboard", filtro: {} });
    expect(parsearHash("#/epicas/1/extra")).toEqual({ pagina: "dashboard", filtro: {} });
    expect(parsearHash("#/epicas/0")).toEqual({ pagina: "dashboard", filtro: {} });
  });

  it("mapea las páginas de sprints y analítica", () => {
    expect(parsearHash("#/sprints")).toEqual({ pagina: "sprints", filtros: {}, hoja: 1, desplegado: false });
    expect(parsearHash("#/analitica")).toEqual({ pagina: "analitica" });
    // Segmentos de más degradan: no se inventa una ruta.
    expect(parsearHash("#/sprints/45")).toEqual({ pagina: "dashboard", filtro: {} });
    expect(parsearHash("#/analitica/verificacion")).toEqual({ pagina: "dashboard", filtro: {} });
  });

  it("lee el filtro de QA del dashboard desde el hash", () => {
    // El filtro es un GUID, no un nombre: la asignación vive en el registro local
    // y una persona puede renombrarse sin que sus asignaciones cambien de sitio.
    expect(parsearHash("#/dashboard?qa=g-ana")).toEqual({
      pagina: "dashboard",
      filtro: { qa: "g-ana" },
    });
    expect(parsearHash("#/dashboard")).toEqual({ pagina: "dashboard", filtro: {} });
    // El hash vacío es el dashboard: es donde cae quien no ha elegido nada.
    expect(parsearHash("")).toEqual({ pagina: "dashboard", filtro: {} });
    // Un segmento de más degrada, como en las demás rutas.
    expect(parsearHash("#/dashboard/extra")).toEqual({ pagina: "dashboard", filtro: {} });
  });

  it("el filtro de QA hace el viaje completo sin pérdida", () => {
    const destino = { pagina: "dashboard" as const, filtro: { qa: "g-ana" } };
    expect(enlaceA(destino)).toBe("#/dashboard?qa=g-ana");
    expect(parsearHash(enlaceA(destino))).toEqual(destino);
  });

  it("la vista de equipo QA no tiene filtros que perder", () => {
    expect(parsearHash("#/qa")).toEqual({ pagina: "qa" });
    expect(enlaceA({ pagina: "qa" })).toBe("#/qa");
    // Un segmento de más degrada, como en las demás rutas.
    expect(parsearHash("#/qa/extra")).toEqual({ pagina: "dashboard", filtro: {} });
    // Una query suelta no se acepta: no hay nada que filtrar ahí y aceptarla
    // daría la impresión de que el filtro se aplicó.
    expect(parsearHash("#/qa?persona=g-ana")).toEqual({ pagina: "qa" });
  });

  it("mapea la página de pruebas, sin filtros y con ellos", () => {
    expect(parsearHash("#/pruebas")).toEqual({ pagina: "pruebas", filtro: {}, hoja: 1 });
    expect(parsearHash("#/pruebas?sprint=Proyecto%5CSprint%2045&pagina=3")).toEqual({
      pagina: "pruebas",
      filtro: { sprint: "Proyecto\\Sprint 45" },
      hoja: 3,
    });
    // Misma regla que el resto: un segmento de más degrada al dashboard.
    expect(parsearHash("#/pruebas/cobertura")).toEqual({ pagina: "dashboard", filtro: {} });
  });

  it("ignora los filtros que la vista de pruebas no tiene", () => {
    // `tipo` y `etiqueta` son de la vista de sprints. Aceptarlos aquí daría un
    // filtro que el backend no aplica: la lista saldría sin filtrar y parecería
    // que el filtro no funciona.
    expect(parsearHash("#/pruebas?tipo=Bug&soloAbiertos=1")).toEqual({
      pagina: "pruebas",
      filtro: {},
      hoja: 1,
    });
  });

  it("hace el viaje completo de los filtros de pruebas sin pérdida", () => {
    const destino = {
      pagina: "pruebas" as const,
      filtro: { sprint: "Proyecto\\Sprint 45", persona: "g-1" },
      hoja: 2,
    };
    expect(parsearHash(enlaceA(destino))).toEqual(destino);
  });

  it("lee los filtros de la vista de sprint desde el hash", () => {
    expect(
      parsearHash("#/sprints?sprint=Proyecto%5CSprint%2045&persona=g-1&tipo=Bug"),
    ).toEqual({
      pagina: "sprints",
      filtros: { sprint: "Proyecto\\Sprint 45", persona: "g-1", tipo: "Bug" },
      hoja: 1,
      desplegado: false,
    });
  });

  it("lee la hoja del hash y normaliza valores imposibles", () => {
    const hoja = (q: string) => {
      const v = parsearHash(`#/sprints?${q}`);
      return v.pagina === "sprints" ? v.hoja : null;
    };
    expect(hoja("pagina=3")).toBe(3);
    // Una URL escrita a mano no debe dejar la tabla en un estado imposible.
    expect(hoja("pagina=0")).toBe(1);
    expect(hoja("pagina=-5")).toBe(1);
    expect(hoja("pagina=abc")).toBe(1);
    expect(hoja("")).toBe(1);
  });

  it("convierte soloAbiertos a booleano y omite los valores inactivos", () => {
    const activo = parsearHash("#/sprints?soloAbiertos=1");
    expect(activo.pagina === "sprints" && activo.filtros.soloAbiertos).toBe(true);
    // `soloAbiertos=no` no es un filtro activo: la clave no debe existir, para
    // que la clave de caché de React Query sea idéntica a la de sin filtro.
    const inactivo = parsearHash("#/sprints?soloAbiertos=no");
    expect(inactivo).toEqual({ pagina: "sprints", filtros: {}, hoja: 1, desplegado: false });
  });

  it("produce la misma clave de caché con y sin query vacía", () => {
    expect(parsearHash("#/sprints")).toEqual(parsearHash("#/sprints?"));
    // Un `soloAbiertos=0` no activa el filtro: misma clave que no tenerlo.
    expect(parsearHash("#/sprints?soloAbiertos=0")).toEqual(parsearHash("#/sprints"));
    // Los parámetros vacíos tampoco alteran la clave del filtro restante.
    expect(parsearHash("#/sprints?tipo=Bug&sprint=&persona=")).toEqual(
      parsearHash("#/sprints?tipo=Bug"),
    );
  });

  it("ignora parámetros vacíos en vez de crear filtros en blanco", () => {
    // Un `?sprint=` dejaría el selector sin valor si no se normalizara.
    const vista = parsearHash("#/sprints?sprint=&tipo=Bug");
    expect(vista.pagina === "sprints" && vista.filtros.sprint).toBeUndefined();
  });
});

describe("filtros compartibles", () => {
  it("omite los filtros vacíos al serializar", () => {
    expect(filtrosAQuery({})).toBe("");
    expect(filtrosAQuery({ sprint: "", tipo: undefined })).toBe("");
    expect(filtrosAQuery({ tipo: "Bug", soloAbiertos: false })).toBe("tipo=Bug");
  });

  it("hace el viaje completo hash → filtros → hash sin pérdida", () => {
    const original = {
      sprint: "Proyecto de ejemplo\\Sprint 45",
      persona: "Ana Pérez",
      tipo: "Bug",
      etiqueta: "verificado-qa",
      soloAbiertos: true,
    };
    const vuelta = parsearHash(`#/sprints?${filtrosAQuery(original)}`);
    expect(vuelta).toEqual({ pagina: "sprints", filtros: original, hoja: 1, desplegado: false });
    // Y la URL generada es estable: compartirla dos veces da lo mismo.
    expect(enlaceA(vuelta)).toBe(`#/sprints?${filtrosAQuery(original)}`);
  });

  it("el enlace de la barra no arrastra filtros ni página de la vista anterior", () => {
    expect(enlaceA({ pagina: "sprints", filtros: {}, hoja: 1, desplegado: false })).toBe("#/sprints");
  });
});

describe("paginación en la URL", () => {
  it("convierte la hoja en desplazamiento", () => {
    expect(hojaAOffset(1)).toBe(0);
    expect(hojaAOffset(2)).toBe(200);
    expect(hojaAOffset(3)).toBe(400);
    // Hojas imposibles caen a la primera, no a un desplazamiento negativo.
    expect(hojaAOffset(0)).toBe(0);
    expect(hojaAOffset(-3)).toBe(0);
    expect(hojaAOffset(2.7)).toBe(200);
  });

  it("calcula cuántas hojas hacen falta", () => {
    expect(totalHojas(0)).toBe(1);
    expect(totalHojas(1)).toBe(1);
    expect(totalHojas(200)).toBe(1);
    expect(totalHojas(201)).toBe(2);
    expect(totalHojas(5651)).toBe(29);
  });

  it("omite la hoja 1 para mantener las URLs cortas", () => {
    expect(filtrosAQuery({}, 1)).toBe("");
    expect(filtrosAQuery({}, 2)).toBe("pagina=2");
    expect(enlaceA({ pagina: "sprints", filtros: {}, hoja: 1, desplegado: false })).toBe("#/sprints");
    expect(enlaceA({ pagina: "sprints", filtros: {}, hoja: 3, desplegado: false })).toBe(
      "#/sprints?pagina=3",
    );
  });

  it("la hoja de pruebas tiene su propio desplazamiento", () => {
    // 200 ítems del índice y 50 historias sin caso: con una sola regla, una de las
    // dos paginaciones calcularía un `offset` que no corresponde con su hoja.
    expect(hojaPruebasAOffset(1)).toBe(0);
    expect(hojaPruebasAOffset(2)).toBe(50);
    expect(hojaPruebasAOffset(8)).toBe(350);
    expect(hojaPruebasAOffset(0)).toBe(0);
    expect(totalHojasPruebas(361)).toBe(8);
    expect(totalHojasPruebas(50)).toBe(1);
    expect(totalHojasPruebas(0)).toBe(1);
  });

  it("la hoja no cuenta como filtro activo", () => {
    // El badge dice «Limpiar N filtros»; la página no es un filtro.
    expect(contarFiltros({})).toBe(0);
    expect(contarFiltros({ tipo: "Bug" })).toBe(1);
  });

  it("hace el viaje completo hoja → hash → hoja", () => {
    const destino = { pagina: "sprints", filtros: { tipo: "Bug" }, hoja: 4, desplegado: false } as const;
    expect(parsearHash(enlaceA(destino))).toEqual(destino);
  });
});

describe("revelado progresivo del detalle", () => {
  it("lee el estado desplegado del hash", () => {
    const de = (q: string) => {
      const v = parsearHash(`#/sprints?${q}`);
      return v.pagina === "sprints" ? v.desplegado : null;
    };
    expect(de("desplegado=1")).toBe(true);
    expect(de("desplegado=true")).toBe(true);
    // Un valor inactivo equivale a no desplegado: así la clave de caché de
    // React Query es la misma que sin el parámetro.
    expect(de("desplegado=0")).toBe(false);
    expect(de("desplegado=no")).toBe(false);
    expect(de("")).toBe(false);
  });

  it("omite el parámetro cuando no está desplegado", () => {
    expect(filtrosAQuery({}, 1, false)).toBe("");
    expect(filtrosAQuery({}, 1, true)).toBe("desplegado=1");
    expect(
      enlaceA({ pagina: "sprints", filtros: {}, hoja: 1, desplegado: true }),
    ).toBe("#/sprints?desplegado=1");
  });

  it("hace el viaje completo desplegado → hash → desplegado", () => {
    const destino = { pagina: "sprints", filtros: {}, hoja: 1, desplegado: true } as const;
    expect(parsearHash(enlaceA(destino))).toEqual(destino);
  });
});

describe("enlaceA", () => {
  it("genera hrefs coherentes", () => {
    expect(enlaceA({ pagina: "dashboard", filtro: {} })).toBe("#/dashboard");
    expect(enlaceA({ pagina: "epica", azureId: 100 })).toBe("#/epicas/100");
    expect(enlaceA({ pagina: "epicaTareas", azureId: 100 })).toBe("#/epicas/100/tareas");
    expect(enlaceA({ pagina: "epicaBugs", azureId: 100 })).toBe("#/epicas/100/bugs");
    expect(enlaceA({ pagina: "analitica" })).toBe("#/analitica");
    expect(enlaceA({ pagina: "sprints", filtros: { tipo: "Bug" }, hoja: 1, desplegado: false })).toBe(
      "#/sprints?tipo=Bug",
    );
  });
});

describe("useVista", () => {
  it("reacciona a los cambios de hash", () => {
    const previo = window.location.hash;
    window.location.hash = "#/epicas/7";
    render(<SondaVista />);
    expect(screen.getByTestId("vista").textContent).toBe("epica:7");

    act(() => {
      irA({ pagina: "dashboard", filtro: {} });
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(screen.getByTestId("vista").textContent).toBe("dashboard");

    window.location.hash = previo;
  });

  it("cambiar un filtro re-renderiza con la vista ya filtrada", () => {
    const previo = window.location.hash;
    window.location.hash = "#/sprints";
    render(<SondaVista />);
    expect(screen.getByTestId("vista").textContent).toBe("sprints:-");

    act(() => {
      window.location.hash = "#/sprints?tipo=Bug";
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(screen.getByTestId("vista").textContent).toBe("sprints:Bug");

    window.location.hash = previo;
  });
});