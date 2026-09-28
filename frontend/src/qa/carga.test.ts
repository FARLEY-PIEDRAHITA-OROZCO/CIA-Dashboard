/** Pruebas de la lógica de la vista de equipo QA, sin React.
 */

import { describe, expect, it } from "vitest";

import type { PersonaQA, SugerenciaQA } from "../api/tipos";
import {
  conteoPorCategoria,
  personasOrdenadas,
  resumenCarga,
  resumenSugerencias,
  textoRol,
  tituloObsoleto,
} from "./carga";

function persona(m: Partial<PersonaQA> & { guid: string; nombre: string }): PersonaQA {
  return {
    es_qa: false,
    es_dev: false,
    forzado: null,
    epicas: 0,
    epicas_qa: 0,
    epicas_dev: 0,
    mas_antigua: "",
    dias_laborables: 0,
    items_backlog: 0,
    bugs: 0,
    ...m,
  };
}

const ANA = persona({ guid: "a", nombre: "Ana", es_qa: true, epicas: 5, dias_laborables: 100 });
const LUIS = persona({ guid: "l", nombre: "Luis", es_dev: true, epicas: 5, dias_laborables: 200 });
const NORA = persona({ guid: "n", nombre: "Nora", epicas: 0 });
const IKER = persona({ guid: "i", nombre: "Iker", es_qa: true, es_dev: true, epicas: 1 });

const PERSONAS = [NORA, LUIS, ANA, IKER];

describe("personasOrdenadas", () => {
  it("ordena por épicas y luego por días, no alfabéticamente", () => {
    // La pregunta de esta vista es quién lleva más trabajo de pruebas; una
    // lista alfabética de 35 personas obliga a recorrerla entera.
    const orden = personasOrdenadas(PERSONAS, "todas").map((p) => p.nombre);
    expect(orden.slice(0, 2)).toEqual(["Luis", "Ana"]);
  });

  it("desempata por nombre, para que el orden sea estable", () => {
    const a = persona({ guid: "1", nombre: "Zeta", epicas: 5, dias_laborables: 50 });
    const b = persona({ guid: "2", nombre: "Alfa", epicas: 5, dias_laborables: 50 });
    expect(personasOrdenadas([a, b], "todas").map((p) => p.nombre)).toEqual(["Alfa", "Zeta"]);
  });

  it("el orden no depende del orden de entrada", () => {
    const ida = personasOrdenadas(PERSONAS, "todas").map((p) => p.guid);
    const vuelta = personasOrdenadas([...PERSONAS].reverse(), "todas").map((p) => p.guid);
    expect(vuelta).toEqual(ida);
  });

  it("filtra por QA", () => {
    // Ana tiene 5 épicas e Iker 1, así que el orden por carga manda sobre el
    // alfabético. El filtro selecciona; el orden sigue siendo el de siempre.
    expect(personasOrdenadas(PERSONAS, "qa").map((p) => p.nombre)).toEqual(["Ana", "Iker"]);
  });

  it("filtra por desarrollo", () => {
    expect(personasOrdenadas(PERSONAS, "dev").map((p) => p.nombre)).toEqual(["Luis", "Iker"]);
  });

  it("«sin rol» excluye a quien tiene los dos", () => {
    // Iker es QA y dev, así que no está «sin rol»; meterlo ahí sería decir que
    // no tiene papel cuando tiene dos.
    expect(personasOrdenadas(PERSONAS, "sin_rol").map((p) => p.nombre)).toEqual(["Nora"]);
  });

  it("filtra por quien tiene épicas", () => {
    expect(personasOrdenadas(PERSONAS, "con_epicas").map((p) => p.nombre)).not.toContain("Nora");
  });
});

describe("conteoPorCategoria", () => {
  it("cuenta cada categoría, aunque solapen", () => {
    const c = conteoPorCategoria(PERSONAS);
    expect(c).toEqual({ todas: 4, qa: 2, dev: 2, sin_rol: 1, con_epicas: 3 });
  });

  it("una lista vacía no rompe", () => {
    expect(conteoPorCategoria([]).todas).toBe(0);
  });
});

describe("textoRol", () => {
  it("nombra los dos roles cuando tiene los dos", () => {
    expect(textoRol(IKER)).toBe("QA y desarrollo");
  });

  it("devuelve null sin rol, no un guion", () => {
    // Quien no tiene rol no tiene un dato vacío: es una decisión sin tomar, y
    // la vista necesita poder decirlo.
    expect(textoRol(NORA)).toBeNull();
  });
});

describe("resumenCarga", () => {
  it("no confunde cero días con cero épicas", () => {
    expect(resumenCarga(NORA)).toBe("sin épicas asignadas");
    expect(resumenCarga(persona({ guid: "z", nombre: "Z", epicas: 1, dias_laborables: 0 }))).toBe(
      "1 épica · desde hoy",
    );
  });

  it("usa días laborables, nunca horas", () => {
    expect(resumenCarga(ANA)).toMatch(/laborables/);
    expect(resumenCarga(ANA)).not.toMatch(/hora/i);
  });
});

describe("sugerencias", () => {
  const s = (guid: string, nombre: string, activos: number, ya = false): SugerenciaQA => ({
    guid,
    nombre,
    activos,
    ya_es_qa: ya,
  });

  it("ofrece a quien aún no está marcado como QA", () => {
    // Volver a ofrecer a alguien que ya es QA como sugerencia es ruido que hace
    // dudar de la pantalla entera.
    const r = resumenSugerencias([s("1", "Ana", 9), s("2", "Luis", 4, true)]);
    expect(r.visibles.map((x) => x.nombre)).toEqual(["Ana"]);
    expect(r.total).toBe(1);
  });

  it("ordena por volumen de activos", () => {
    const r = resumenSugerencias([s("1", "Ana", 4), s("2", "Luis", 40)]);
    expect(r.visibles[0].nombre).toBe("Luis");
  });

  it("pone un techo, para que una heurística no se lea como veredicto", () => {
    const muchas = Array.from({ length: 30 }, (_, i) => s(String(i), `P${i}`, 30 - i));
    const r = resumenSugerencias(muchas);
    expect(r.total).toBe(30);
    expect(r.visibles).toHaveLength(10);
  });
});

describe("tituloObsoleto", () => {
  it("usa el título cuando la épica sigue en Azure", () => {
    expect(tituloObsoleto({ titulo_conocido: true, titulo: "Buzón" })).toBe("Buzón");
  });

  it("avisa cuando la épica ya no está, sin inventar un título", () => {
    // Esconder la fila sería perderla de vista; lo único que se puede hacer con
    // ella es quitarla, así que hay que poder verla.
    expect(tituloObsoleto({ titulo_conocido: false, titulo: "" })).toMatch(/ya no está en Azure/);
  });
});
