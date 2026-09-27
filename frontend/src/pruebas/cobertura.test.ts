/** Pruebas de la lógica pura de la cinta de cobertura y su veredicto. */

import { describe, expect, it } from "vitest";

import type { CoberturaDeSprint, ResumenPruebas } from "../api/tipos";
import {
  construirColumnas,
  describirColumna,
  hayCobertura,
  tonoColumna,
  veredictoBrecha,
  veredictoSprint,
} from "./cobertura";

function sprint(
  nombre: string,
  historias: number,
  cubiertas: number,
  extra: Partial<CoberturaDeSprint> = {},
): CoberturaDeSprint {
  return {
    nombre,
    ruta: `Proyecto\\${nombre}`,
    historias,
    cubiertas,
    sin_cubrir: Math.max(0, historias - cubiertas),
    pct_cubiertas: historias > 0 ? Math.round((cubiertas / historias) * 1000) / 10 : 0,
    ...extra,
  };
}

function resumen(extra: Partial<ResumenPruebas> = {}): ResumenPruebas {
  return {
    inventario: { planes: 44, suites: 457, casos: 3431, total: 3932 },
    estados: { "Test Case": { Design: 1577, Closed: 1722, Ready: 132 } },
    automatizacion: {
      casos: 3431,
      automatizados: 0,
      planificados: 53,
      manuales: 3378,
      pct_automatizado: 0,
    },
    diseno: { en_diseno: 1577, sin_mover: 624, dias: 180 },
    brecha: {
      historias: 601,
      cubiertas: 240,
      sin_cubrir: 361,
      pct_cubiertas: 39.9,
      parcial: false,
      requisitos_cubiertos_total: 352,
    },
    parcial: false,
    generado: "2026-09-27T00:00:00Z",
    ...extra,
  };
}

describe("construirColumnas", () => {
  it("conserva el orden que da el backend", () => {
    // El backend ya ordena con criterio numérico tolerante. Reordenar aquí con
    // `localeCompare` volvería a poner `Sprint 10` antes que `Sprint 2`.
    const { columnas } = construirColumnas([
      sprint("Sprint 2", 1, 0),
      sprint("Sprint 10", 2, 1),
    ]);
    expect(columnas.map((c) => c.nombre)).toEqual(["Sprint 2", "Sprint 10"]);
  });

  it("calcula la magnitud relativa al sprint más grande", () => {
    const { columnas, maximo } = construirColumnas([
      sprint("Sprint 1", 10, 5),
      sprint("Sprint 2", 40, 20),
    ]);
    expect(maximo).toBe(40);
    expect(columnas[0].magnitud).toBeCloseTo(0.25);
    expect(columnas[1].magnitud).toBe(1);
  });

  it("un sprint sin historias da 0 y no NaN", () => {
    const { columnas } = construirColumnas([sprint("Sprint 1", 0, 0)]);
    expect(columnas[0].cobertura).toBe(0);
    expect(columnas[0].magnitud).toBe(0);
  });

  it("el hueco se recalcula por si Covered viene por encima de historias", () => {
    // El backend ya acota, pero una respuesta corrupta no debe pintar una
    // columna con más historias que huecos y un porcentaje sobre 100.
    const { columnas } = construirColumnas([sprint("Sprint 1", 5, 9)]);
    expect(columnas[0].cubiertas).toBe(5);
    expect(columnas[0].sinCubrir).toBe(0);
    expect(columnas[0].cobertura).toBe(1);
  });

  it("lista vacía no rompe y no inventa un peor sprint", () => {
    const cinta = construirColumnas([]);
    expect(cinta.columnas).toEqual([]);
    expect(cinta.maximo).toBe(0);
    expect(cinta.peorSprint).toBeNull();
    expect(cinta.sprintsConHueco).toBe(0);
  });

  it("el peor sprint ignora los que no tienen historias", () => {
    // Un sprint vacío tiene cobertura 0 y sería siempre «el peor», que no dice
    // nada: la pregunta es qué sprint tiene más historias sin probar.
    const { peorSprint } = construirColumnas([
      sprint("Sprint 1", 0, 0),
      sprint("Sprint 2", 10, 9),
      sprint("Sprint 3", 20, 2),
    ]);
    expect(peorSprint?.nombre).toBe("Sprint 3");
  });

  it("cuenta los sprints con alguna historia sin caso", () => {
    const cinta = construirColumnas([
      sprint("Sprint 1", 10, 10),
      sprint("Sprint 2", 10, 9),
      sprint("Sprint 3", 10, 0),
    ]);
    expect(cinta.sprintsConHueco).toBe(2);
  });
});

describe("tonoColumna", () => {
  it("sin historias es neutro: no se puede calificar", () => {
    expect(tonoColumna(construirColumnas([sprint("S1", 0, 0)]).columnas[0])).toBe("neutro");
  });

  it("todo cubierto es correcto", () => {
    expect(tonoColumna(construirColumnas([sprint("S1", 10, 10)]).columnas[0])).toBe("ok");
  });

  it("menos de la mitad cubierta es alerta", () => {
    expect(tonoColumna(construirColumnas([sprint("S1", 10, 4)]).columnas[0])).toBe("alerta");
  });

  it("entre la mitad y todo es acento, no alerta", () => {
    expect(tonoColumna(construirColumnas([sprint("S1", 10, 8)]).columnas[0])).toBe("acento");
  });

  it("el tono es la brecha, no el volumen", () => {
    // Un sprint enorme con cinco casos es peor noticia que uno de tres historias
    // con dos, aunque ocupe menos columna.
    const grande = construirColumnas([sprint("Grande", 39, 5)]).columnas[0];
    const chico = construirColumnas([sprint("Chico", 3, 2)]).columnas[0];
    expect(tonoColumna(grande)).toBe("alerta");
    expect(tonoColumna(chico)).toBe("acento");
  });
});

describe("describirColumna", () => {
  it("dice las dos mitades, que es lo que la etiqueta tiene que comunicar", () => {
    const columna = construirColumnas([sprint("Sprint 45", 39, 5)]).columnas[0];
    expect(describirColumna(columna)).toBe(
      "Sprint 45, 5 historias con caso, 34 historias sin caso",
    );
  });
});

describe("veredictoBrecha", () => {
  it("el titular es el número accionable", () => {
    const veredicto = veredictoBrecha(resumen(), construirColumnas([]));
    expect(veredicto.titular).toBe("361 historias sin caso de prueba · 39.9% cubierto");
  });

  it("el tono sigue a la brecha", () => {
    const cinta = construirColumnas([]);
    expect(veredictoBrecha(resumen(), cinta).tono).toBe("alerta");
    const buena = resumen({
      brecha: {
        historias: 100,
        cubiertas: 90,
        sin_cubrir: 10,
        pct_cubiertas: 90,
        parcial: false,
        requisitos_cubiertos_total: 95,
      },
    });
    expect(veredictoBrecha(buena, cinta).tono).toBe("ok");
  });

  it("sin datos dice que está midiendo, no que no hay nada", () => {
    const veredicto = veredictoBrecha(undefined, construirColumnas([]));
    expect(veredicto.titular).toContain("Midiendo");
    expect(veredicto.tono).toBe("neutro");
  });

  it("propaga la marca de parcial", () => {
    const veredicto = veredictoBrecha(
      resumen({
        parcial: true,
        brecha: {
          historias: 601,
          cubiertas: 240,
          sin_cubrir: 361,
          pct_cubiertas: 39.9,
          parcial: true,
          requisitos_cubiertos_total: 352,
        },
      }),
      construirColumnas([]),
    );
    expect(veredicto.parcial).toBe(true);
  });

  it("el detalle nombra el peor sprint, que es por dónde empezar", () => {
    const cinta = construirColumnas([
      sprint("Sprint 44", 24, 11),
      sprint("Sprint 45", 39, 5),
    ]);
    const veredicto = veredictoBrecha(resumen(), cinta);
    expect(veredicto.detalle).toContain("2 sprints con alguna historia sin probar");
    // 5 de 39 es 12,8 %; se redondea a 13 para no fingir precisión de un decimal
    // que en una barra de 12 píxeles no se distingue.
    expect(veredicto.detalle).toContain("el peor es Sprint 45 (13%)");
  });

  it("el detalle de automatización solo aparece cuando aporta", () => {
    const cinta = construirColumnas([]);
    const sinAutomatizar = veredictoBrecha(resumen(), cinta);
    expect(sinAutomatizar.detalle).toContain("3378 casos sin automatizar");

    const conAutomatizado = veredictoBrecha(
      resumen({
        automatizacion: {
          casos: 100,
          automatizados: 40,
          planificados: 0,
          manuales: 60,
          pct_automatizado: 40,
        },
      }),
      cinta,
    );
    // Con el 40 % automatizado la cifra ya está en su propia tarjeta: repetirla
    // aquí solo restaría atención al titular.
    expect(conAutomatizado.detalle).not.toContain("sin automatizar");
  });
});

describe("veredictoSprint", () => {
  it("el detalle de un sprint sin historias lo dice", () => {
    const columna = construirColumnas([sprint("Sprint 2", 0, 0)]).columnas[0];
    expect(veredictoSprint(columna).detalle).toBe("sin historias en este sprint");
  });

  it("una columna filtrada nunca declara parcial", () => {
    // La parcialidad es de la lectura completa, no de un sprint: repetirla aquí
    // daría a entender que este sprint en concreto está mal leído.
    const columna = construirColumnas([sprint("Sprint 1", 10, 2)]).columnas[0];
    expect(veredictoSprint(columna).parcial).toBe(false);
  });

  it("un sprint sin brecha es correcto", () => {
    const columna = construirColumnas([sprint("Sprint 1", 3, 3)]).columnas[0];
    expect(veredictoSprint(columna).tono).toBe("ok");
  });
});

describe("hayCobertura", () => {
  it("no hay cinta sin sprints", () => {
    expect(hayCobertura(undefined)).toBe(false);
    expect(
      hayCobertura({
        resumen: {
          historias: 0,
          cubiertas: 0,
          sin_cubrir: 0,
          pct_cubiertas: 0,
          parcial: false,
          requisitos_cubiertos_total: 0,
          lotes_con_error: 0,
          generado: "",
        },
        sprints: [],
      }),
    ).toBe(false);
  });

  it("con un solo sprint ya hay cinta", () => {
    expect(
      hayCobertura({
        resumen: {
          historias: 1,
          cubiertas: 0,
          sin_cubrir: 1,
          pct_cubiertas: 0,
          parcial: false,
          requisitos_cubiertos_total: 0,
          lotes_con_error: 0,
          generado: "",
        },
        sprints: [sprint("Sprint 1", 1, 0)],
      }),
    ).toBe(true);
  });
});
