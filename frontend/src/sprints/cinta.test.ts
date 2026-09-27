import { describe, expect, it } from "vitest";

import type { ListaSprints, PersonaCarga, Sprint } from "../api/tipos";
import {
  construirCinta,
  construirColumnas,
  describirColumna,
  tonoColumna,
} from "./cinta";
import { plural, veredictoFiltrado, veredictoSprint } from "./veredicto";

function sprint(over: Partial<Sprint> & { nombre: string }): Sprint {
  return {
    ruta: `Proyecto de ejemplo\\${over.nombre}`,
    total: 10,
    abiertos: 4,
    cerrados: 6,
    personas: 3,
    ultimo_cambio: "2026-09-20T10:00:00Z",
    ...over,
  };
}

const CATALOGO: Sprint[] = [
  sprint({ nombre: "Sprint 1", total: 12, cerrados: 8, abiertos: 4 }),
  sprint({ nombre: "Sprint 2", total: 40, cerrados: 10, abiertos: 30 }),
  sprint({ nombre: "Sprint 3", total: 8, cerrados: 8, abiertos: 0 }),
  sprint({ nombre: "Sprint 4", total: 20, cerrados: 5, abiertos: 15 }),
];

describe("construirColumnas", () => {
  it("conserva el orden del catálogo", () => {
    const columnas = construirColumnas(CATALOGO, "Sprint 4");
    expect(columnas.map((c) => c.nombre)).toEqual([
      "Sprint 1",
      "Sprint 2",
      "Sprint 3",
      "Sprint 4",
    ]);
  });

  it("escala la altura contra el sprint más grande", () => {
    const columnas = construirColumnas(CATALOGO, "Sprint 4");
    // Sprint 2 es el mayor con 40: su magnitud es 1 y el resto se escala.
    expect(columnas[1].magnitud).toBe(1);
    expect(columnas[0].magnitud).toBeCloseTo(12 / 40);
    expect(columnas[2].magnitud).toBeCloseTo(8 / 40);
  });

  it("calcula la fracción cerrada sin NaN cuando no hay ítems", () => {
    const vacio = construirColumnas([sprint({ nombre: "Vacío", total: 0, cerrados: 0 })], "");
    expect(vacio[0].cierre).toBe(0);
    expect(vacio[0].magnitud).toBe(0);
    expect(Number.isNaN(vacio[0].cierre)).toBe(false);
  });

  it("marca como histórico todo lo anterior al sprint actual", () => {
    const columnas = construirColumnas(CATALOGO, "Sprint 3");
    expect(columnas.map((c) => c.historico)).toEqual([true, true, false, false]);
    expect(columnas[2].actual).toBe(true);
  });

  it("el rezago de un sprint histórico es exactamente lo que dejó abierto", () => {
    const columnas = construirColumnas(CATALOGO, "Sprint 4");
    expect(columnas[0].rezago).toBe(4);
    expect(columnas[1].rezago).toBe(30);
    // Sprint 3 no dejó nada abierto.
    expect(columnas[2].rezago).toBe(0);
    // El actual y los posteriores no pueden arrastrar deuda: aún no ocurrió.
    expect(columnas[3].rezago).toBe(0);
  });

  it("si el sprint actual no está, trata todo como histórico", () => {
    // Es la lectura conservadora: marcar como rezago lo que no ha ocurrido
    // inflaría el número, omitirlo lo rebajaría.
    const columnas = construirColumnas(CATALOGO, "Sprint 99");
    expect(columnas.every((c) => c.historico)).toBe(true);
    expect(columnas.every((c) => c.actual === false)).toBe(true);
  });

  it("clamp-ee los datos inconsistentes en vez de producir barras imposibles", () => {
    // Azure es texto libre: un `cerrados` mayor que `total` daría más de 100 %.
    const raro = construirColumnas(
      [sprint({ nombre: "Raro", total: 10, cerrados: 25, abiertos: -3 })],
      "",
    );
    expect(raro[0].cerrados).toBe(10);
    expect(raro[0].abiertos).toBe(0);
    expect(raro[0].cierre).toBe(1);
  });

  it("el catálogo vacío no falla", () => {
    expect(construirColumnas([], "Sprint 1")).toEqual([]);
  });
});

describe("construirCinta", () => {
  it("suma el rezago de los sprints con deuda", () => {
    const cinta = construirCinta(CATALOGO, "Sprint 4");
    expect(cinta.rezagoTotal).toBe(34);
    expect(cinta.sprintsConRezago).toBe(2);
    expect(cinta.historicos).toBe(3);
    expect(cinta.maximo).toBe(40);
  });

  it("sin sprints el resumen es cero, no NaN", () => {
    const cinta = construirCinta([], "");
    expect(cinta.rezagoTotal).toBe(0);
    expect(cinta.maximo).toBe(0);
    expect(cinta.columnas).toEqual([]);
  });
});

describe("tonoColumna", () => {
  it("el sprint actual siempre destaca", () => {
    const columnas = construirColumnas(CATALOGO, "Sprint 4");
    expect(tonoColumna(columnas[3])).toBe("acento");
  });

  it("un histórico con deuda es alerta y sin deuda es correcto", () => {
    const columnas = construirColumnas(CATALOGO, "Sprint 4");
    expect(tonoColumna(columnas[1])).toBe("alerta"); // 30 sin cerrar
    expect(tonoColumna(columnas[2])).toBe("ok"); // cerrado del todo
  });

  it("un histórico sin ítems es neutro, no «correcto»", () => {
    const columnas = construirColumnas(
      [sprint({ nombre: "Vacío", total: 0, cerrados: 0 })],
      "Sprint 1",
    );
    expect(tonoColumna(columnas[0])).toBe("neutro");
  });

  it("los sprints futuros dependen del cierre", () => {
    const columnas = construirColumnas(
      [
        sprint({ nombre: "Ahora", total: 10, cerrados: 5 }),
        sprint({ nombre: "Después", total: 10, cerrados: 9 }),
      ],
      "Ahora",
    );
    expect(tonoColumna(columnas[0])).toBe("acento");
    expect(tonoColumna(columnas[1])).toBe("ok");
  });
});

describe("describirColumna", () => {
  it("incluye nombre, totales y la marca que explica el tono", () => {
    const columnas = construirColumnas(CATALOGO, "Sprint 4");
    expect(describirColumna(columnas[3])).toContain("sprint actual");
    expect(describirColumna(columnas[1])).toContain("30 sin cerrar");
    expect(describirColumna(columnas[2])).not.toContain("sin cerrar");
  });
});

describe("plural", () => {
  it("usa la forma singular solo para 1", () => {
    expect(plural(0, "ítem")).toBe("0 ítems");
    expect(plural(1, "ítem")).toBe("1 ítem");
    expect(plural(2, "ítem")).toBe("2 ítems");
  });

  it("acepta la forma plural cuando no basta con añadir «s»", () => {
    expect(plural(1, "abierto", "abiertos")).toBe("1 abierto");
    expect(plural(3, "abierto", "abiertos")).toBe("3 abiertos");
  });
});

describe("veredictoSprint", () => {
  it("resume un sprint con su cierre y su gente", () => {
    const v = veredictoSprint(CATALOGO[0], false);
    expect(v.titular).toBe("Sprint 1");
    expect(v.detalle).toBe("4 abiertos de 12 ítems · 67% cerrado · 3 personas");
  });

  it("marca el sprint actual en el titular", () => {
    expect(veredictoSprint(CATALOGO[3], true).titular).toBe("Sprint 4 · sprint actual");
  });

  it("un sprint por debajo del 50% cerrado es alerta", () => {
    // Sprint 2: 10 de 40 = 25% cerrado.
    expect(veredictoSprint(CATALOGO[1], false).tono).toBe("alerta");
    expect(veredictoSprint(CATALOGO[2], false).tono).toBe("ok");
  });

  it("un sprint vacío no inventa un porcentaje", () => {
    const v = veredictoSprint(sprint({ nombre: "Vacío", total: 0, cerrados: 0 }), false);
    expect(v.detalle).toBe("sin ítems");
  });
});

describe("veredictoFiltrado", () => {
  const cat: ListaSprints = { sprints: CATALOGO, total: 4, sprint_actual: "Sprint 4", total_items: 62, asignados_a_sprint: 62 };
  const personas: PersonaCarga[] = [
    { guid: "g-1", nombre: "Ana", total: 30, abiertos: 9, bugs: 1, bugs_abiertos: 0, verificados: 0 },
  ];

  it("sin filtros dice el total del proyecto y el rezago acumulado", () => {
    const v = veredictoFiltrado(cat, personas, {}, 80);
    expect(v.titular).toBe("80 ítems en el proyecto");
    expect(v.detalle).toContain("34 ítems rezagados de 2 sprints");
  });

  it("con filtro, la cifra grande es el total filtrado y el detalle nombra el filtro", () => {
    const v = veredictoFiltrado(
      cat,
      personas,
      { sprint: "Proyecto de ejemplo\\Sprint 1" },
      12,
    );
    expect(v.titular).toBe("12 ítems · sprint Sprint 1");
  });

  it("un filtro que no devuelve nada lo dice en vez de parecer vacío", () => {
    const v = veredictoFiltrado(cat, [], { tipo: "Bug" }, 0);
    expect(v.titular).toBe("0 ítems · tipo Bug");
    expect(v.detalle).toContain("ninguno cumple los filtros");
    expect(v.tono).toBe("alerta");
  });

  it("sin rezago acumulado lo dice, para que el 0 signifique algo", () => {
    const limpio: ListaSprints = {
      sprints: [sprint({ nombre: "Sprint 1", total: 10, cerrados: 10, abiertos: 0 })],
      total: 1, sprint_actual: "Sprint 1", total_items: 10, asignados_a_sprint: 10,
    };
    expect(veredictoFiltrado(limpio, [], {}, 10).detalle).toContain("sin deuda acumulada");
  });

  it("dice cuántos ítems no tienen sprint, en vez de dejar que la cuenta cuadre", () => {
    // En el proyecto real: 5.651 ítems, 5.483 en sprints y 168 sin sprint. Si el
    // veredicto solo dijera la suma de las columnas, parecería que la cinta
    // cubre el proyecto entero.
    const conHuecos: ListaSprints = {
      ...cat,
      total_items: 100,
      asignados_a_sprint: 82,
    };
    const v = veredictoFiltrado(conHuecos, personas, {}, 100);
    expect(v.titular).toBe("100 ítems en el proyecto");
    expect(v.detalle).toContain("18 ítems sin sprint asignado");
  });

  it("no menciona los huecos de sprint cuando el filtro ya acota", () => {
    // Con un filtro, el total filtrado viene de `/api/items` y la cuenta de
    // sprints no aplica: sería ruido.
    const v = veredictoFiltrado(cat, [], { tipo: "Bug" }, 3);
    expect(v.detalle).not.toContain("sin sprint asignado");
  });

  it("singulariza el rezago cuando es un solo ítem", () => {
    const conUno: ListaSprints = {
      sprints: [
        sprint({ nombre: "Viejo", total: 1, cerrados: 0, abiertos: 1 }),
        sprint({ nombre: "Ahora", total: 5, cerrados: 5, abiertos: 0 }),
      ],
      total: 2, sprint_actual: "Ahora", total_items: 6, asignados_a_sprint: 6,
    };
    expect(veredictoFiltrado(conUno, [], {}, 6).detalle).toContain("1 ítem rezagado de 1 sprint");
  });
});
