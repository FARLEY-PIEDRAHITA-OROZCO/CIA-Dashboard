"""Servicio del registro local de pruebas: quién es QA y qué épica lleva.

**Por qué un registro propio y no un campo de Azure.** No existe ningún campo
para esto: las épicas no las crea el equipo de QA, así que Azure no sabe a quién
le corresponde probarlas. La información solo existe aquí, y por eso la pérdida
de este fichero es irrecuperable: no hay de dónde releerla.

El servicio razona sobre :class:`Instantanea` y devuelve dicts para la API. No
conoce el formato en disco: eso es del adaptador. Y no escribe en Azure, ni
siquiera opcionalmente.

El módulo vive en la aplicación porque hay dos fuentes que cruza:

* :class:`IndiceWorkItems`, para validar que el GUID de una persona existe de
  verdad y para dar nombres estables.
* :class:`IndicePruebas`, para **sugerir** quién es QA según qué touche activos
  de prueba.

Las dos se leen en memoria; asignar no cuesta ninguna llamada a Azure.
"""

import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from ..domain.models import (
    ROLES,
    Asignacion,
    Instantanea,
    PerfilPersona,
)
from ..domain.ports import RegistroAsignacionesPort
from ..infrastructure.registro_json import ErrorRegistro, RegistroModificado
from .indice import IndiceWorkItems
from .indice_pruebas import IndicePruebas

logger = logging.getLogger("devops")

#: Días laborables por defecto, 0 = lunes. Medido en
#: `work/teamSettings.workingDays`: `['monday' … 'friday']`. Es un parámetro y no
#: una constante fija porque un equipo con otra jornada (sábados, turnos) tendría
#: que poder cambiarlo sin tocar el código.
DIAS_LABORABLES = frozenset({0, 1, 2, 3, 4})

#: Tipos de activo de prueba que delatan a quien hace QA.
TIPOS_PRUEBA_SUGERENCIA = ("Test Case", "Test Suite", "Test Plan")


class AsignacionInvalida(ValueError):
    """La asignación se rechazó por una regla local (no llegó a escribirse)."""


def dias_laborables(
    desde: date,
    hasta: Optional[date] = None,
    laborables: frozenset[int] = DIAS_LABORABLES,
) -> int:
    """Días laborables de `desde` a `hasta`, **ambos incluidos**.

    Inclusivo en los dos extremos porque las otras dos opciones se leen como
    errores: si una épica se asigna hoy y se consulta hoy, Exclusive daría 0
    («no ha pasado nada») y parece que la asignación no se guardó. Contando
    ambos extremos, hoy son 1 día y del lunes al lunes siguiente son 6, que es lo
    que cualquiera contaría a mano.
    """
    fin = hasta or date.today()
    if fin < desde:
        return 0
    total = 0
    cursor = desde
    while cursor <= fin:
        if cursor.weekday() in laborables:
            total += 1
        cursor = date.fromordinal(cursor.toordinal() + 1)
    return total


class ServicioRegistro:
    """Operaciones sobre perfiles y asignaciones de pruebas."""

    def __init__(
        self,
        registro: RegistroAsignacionesPort,
        indice: IndiceWorkItems,
        indice_pruebas: IndicePruebas | None = None,
    ) -> None:
        self._registro = registro
        self._indice = indice
        self._indice_pruebas = indice_pruebas

    # ------------------------------------------------------------------ #
    # Lectura
    # ------------------------------------------------------------------ #
    async def instantanea(self) -> Instantanea:
        """El registro tal cual está. La usan las escrituras para no pisar."""
        return await self._registro.leer()

    async def asignaciones(
        self,
        *,
        epica: Optional[int] = None,
        persona: Optional[str] = None,
        rol: Optional[str] = None,
    ) -> List[Asignacion]:
        """Asignaciones filtradas. Sin filtros devuelve todas, ordenadas."""
        datos = await self._registro.leer()
        salida = list(datos.asignaciones)
        if epica is not None:
            salida = [a for a in salida if a.epica == epica]
        if persona:
            objetivo = persona.strip().lower()
            salida = [a for a in salida if a.persona.lower() == objetivo]
        if rol:
            salida = [a for a in salida if a.rol == rol]
        return sorted(salida, key=lambda a: (a.epica, a.rol, a.persona))

    async def perfiles(self) -> Dict[str, PerfilPersona]:
        return (await self._registro.leer()).perfiles

    async def personas(self) -> List[Dict[str, Any]]:
        """Las personas de Azure con su rol, su carga y su histórico.

        Se parte de las personas **del índice**, no de las del registro: si alguien
        dejó el proyecto, ya no aparece aquí, y sus asignaciones siguen
        existiendo en el registro (para poder consultarlas y borrarlas) pero no
        se ofrecen como seleccionables para nuevas asignaciones.
        """
        instantanea = await self._registro.leer()
        del_indice = await self._indice.personas()
        por_persona: Dict[str, List[Asignacion]] = {}
        for a in instantanea.asignaciones:
            por_persona.setdefault(a.persona, []).append(a)
        hoy = date.today()
        filas: List[Dict[str, Any]] = []
        for persona in del_indice:
            guid = persona["guid"]
            perfil = instantanea.perfiles.get(guid) or PerfilPersona(guid=guid)
            propias = sorted(por_persona.get(guid, []), key=lambda a: a.desde)
            filas.append(
                {
                    "guid": guid,
                    "nombre": persona["nombre"],
                    "es_qa": perfil.es_qa,
                    "es_dev": perfil.es_dev,
                    "forzado": perfil.forzado,
                    "epicas": len({a.epica for a in propias}),
                    "epicas_qa": len({a.epica for a in propias if a.rol == "qa"}),
                    "epicas_dev": len({a.epica for a in propias if a.rol == "dev"}),
                    "mas_antigua": propias[0].desde.isoformat() if propias else "",
                    "dias_laborables": max(
                        (dias_laborables(a.desde, hoy) for a in propias), default=0
                    ),
                    # Carga real de Azure, para contrastar con lo declarado aquí.
                    "items_backlog": persona["total"],
                    "bugs": persona["bugs"],
                }
            )
        return filas

    async def carga_por_persona(self) -> List[Dict[str, Any]]:
        """Quién lleva cuántas épicas, ordenado por volumen.

        Es la lectura que responde «en qué está trabajando cada QA». Solo cuenta
        épicas del registro y días laborables: **no** estima horas, porque el
        registro de tiempos de Azure responde 401 y no hay fuente.
        """
        filas = await self.personas()
        con_epicas = [f for f in filas if f["epicas"] > 0]
        con_epicas.sort(key=lambda f: (-f["epicas"], f["nombre"].lower()))
        return con_epicas

    async def sugerencia_qa(self, *, minimo: int = 3) -> List[Dict[str, Any]]:
        """Personas que más tocan activos de prueba, como **sugerencia**.

        Es una heurística y se devuelve como tal: no se guarda sola. Un umbral
        equivocado clasificaría mal a alguien, y una etiqueta de rol equivocada en
        el registro es peor que no proponer nada. Quien decide es la persona.
        """
        if self._indice_pruebas is None:
            return []
        conteo: Dict[str, int] = {}
        for activo in await self._indice_pruebas.todos():
            if activo.tipo not in TIPOS_PRUEBA_SUGERENCIA or not activo.persona:
                continue
            conteo[activo.persona.guid] = conteo.get(activo.persona.guid, 0) + 1
        if not conteo:
            return []
        nombres = {p["guid"]: p["nombre"] for p in await self._indice.personas()}
        ya_marcadas = (await self._registro.leer()).perfiles
        sugeridas = [
            {
                "guid": guid,
                "nombre": nombres.get(guid, guid),
                "activos": cantidad,
                "ya_es_qa": ya_marcadas.get(guid).es_qa if guid in ya_marcadas else False,
            }
            for guid, cantidad in conteo.items()
            if cantidad >= minimo
        ]
        sugeridas.sort(key=lambda s: (-s["activos"], s["nombre"].lower()))
        return sugeridas

    async def carga_por_persona(
        self,
        *,
        titulos: Optional[Dict[int, str]] = None,
    ) -> List[Dict[str, Any]]:
        """Qué épicas lleva cada persona, con los días de cada una.

        `asignaciones` van como modelos :class:`Asignacion` enteros, no como
        dicts proyectados: el mapeo a la respuesta lo hace la API en un solo
        sitio. Proyectar aquí y volver a envolver en la ruta es duplicar el
        mapeo, y dos copias de un mapeo divergen.

        `titulos` es el mapa de id → nombre que resuelve la capa de aplicación
        desde Azure. Va como parámetro y no se pide aquí a propósito: **el
        registro no sabe qué es una épica**. Si una épica se borró de Azure, su
        asignación sigue aquí y hay que poder mostrarla, aunque no se pueda
        resolver su nombre.
        """
        nombres = titulos or {}
        hoy = date.today()
        por_persona: Dict[str, List[Asignacion]] = {}
        for a in await self.asignaciones():
            por_persona.setdefault(a.persona, []).append(a)
        filas = {f["guid"]: f for f in await self.personas()}
        salida: List[Dict[str, Any]] = []
        for guid, propias in por_persona.items():
            perfil = filas.get(guid, {"nombre": "", "items_backlog": 0})
            propias.sort(key=lambda a: (a.desde, a.epica))
            salida.append(
                {
                    "guid": guid,
                    "nombre": perfil.get("nombre", ""),
                    "es_qa": perfil.get("es_qa", False),
                    "es_dev": perfil.get("es_dev", False),
                    "epicas": len({a.epica for a in propias}),
                    "dias_laborables": max(dias_laborables(a.desde, hoy) for a in propias),
                    "desde": propias[0].desde.isoformat(),
                    "items_backlog": perfil.get("items_backlog", 0),
                    "asignaciones": propias,
                    "titulos": nombres,
                }
            )
        salida.sort(key=lambda f: (-f["epicas"], f["nombre"].lower()))
        return salida

    # ------------------------------------------------------------------ #
    # Escritura
    # ------------------------------------------------------------------ #
    async def asignar(
        self,
        epica: int,
        persona: str,
        rol: str,
        *,
        desde: Optional[date] = None,
        nota: str = "",
    ) -> Instantanea:
        """Asigna (o reasigna) una épica a una persona. Idempotente.

        Reasignar la misma pareja no duplica nada: actualiza fecha y nota. Eso
        importa porque la UI reenvía el mismo formulario al cambiar un matiz y
        no debería dejar dos filas para la misma épica y la misma persona.
        """
        if rol not in ROLES:
            raise AsignacionInvalida(
                f"Rol desconocido: {rol!r}. Admitidos: {', '.join(ROLES)}."
            )
        if epica <= 0:
            raise AsignacionInvalida("El id de la épica debe ser un entero positivo.")
        guid = (persona or "").strip()
        if not guid:
            raise AsignacionInvalida("Falta la persona a la que asignar.")

        inicio = desde or date.today()
        if inicio > date.today():
            # Aceptar una fecha futura daría un número de días negativo, que no
            # significa nada. Si lo que se quiere es planificarla, es otra cosa.
            raise AsignacionInvalida(
                f"La fecha de inicio ({inicio.isoformat()}) es futura. "
                "El registro solo lleva asignaciones que ya empiezan."
            )

        await self._exigir_persona_conocida(guid)

        instantanea = await self._registro.leer()
        nueva = Asignacion(epica=epica, persona=guid, rol=rol, desde=inicio, nota=nota.strip())
        resto = [
            a
            for a in instantanea.asignaciones
            if not (a.epica == epica and a.persona == guid and a.rol == rol)
        ]
        instantanea.asignaciones = sorted(
            [*resto, nueva], key=lambda a: (a.epica, a.rol, a.persona)
        )
        return await self._registro.guardar(instantanea)

    async def quitar(self, epica: int, persona: str, rol: str) -> Instantanea:
        """Quita una asignación. Idempotente: si no está, no hace nada.

        No valida que la persona siga en el índice a propósito: hay que poder
        borrar la asignación de alguien que **se ha ido del proyecto**, que es
        justo cuando más urge quitarla.
        """
        guid = (persona or "").strip()
        instantanea = await self._registro.leer()
        antes = len(instantanea.asignaciones)
        instantanea.asignaciones = [
            a for a in instantanea.asignaciones if not (a.epica == epica and a.persona == guid and a.rol == rol)
        ]
        if len(instantanea.asignaciones) == antes:
            return instantanea
        return await self._registro.guardar(instantanea)

    async def marcar_rol(
        self,
        guid: str,
        *,
        es_qa: Optional[bool] = None,
        es_dev: Optional[bool] = None,
        forzado: Optional[bool] = None,
    ) -> Instantanea:
        """Fija el papel de una persona en el registro.

        `forzado=True` deja constancia de que la decisión fue humana, para que la
        sugerencia automática no la vuelva a plantear.
        """
        objetivo = (guid or "").strip()
        if not objetivo:
            raise AsignacionInvalida("Falta el GUID de la persona.")
        await self._exigir_persona_conocida(objetivo)

        instantanea = await self._registro.leer()
        actual = instantanea.perfiles.get(objetivo) or PerfilPersona(guid=objetivo)
        if es_qa is not None:
            actual.es_qa = es_qa
        if es_dev is not None:
            actual.es_dev = es_dev
        if forzado is not None:
            actual.forzado = forzado
        instantanea.perfiles[objetivo] = actual
        return await self._registro.guardar(instantanea)

    async def _exigir_persona_conocida(self, guid: str) -> None:
        """Rechaza un GUID que no está en el índice.

        Sin esta comprobación, un GUID mal escrito crearía una asignación
        imposible de mostrar y de borrar desde la UI: nadie la vería en ninguna
        lista. Un mensaje claro en el momento de asignar es mucho más barato.
        """
        for persona in await self._indice.personas():
            if persona["guid"].lower() == guid.lower():
                return
        raise AsignacionInvalida(
            f"No hay ninguna persona con el GUID {guid} en el proyecto. "
            "Asigna a alguien de la lista; si es nueva, primero tiene que "
            "aparecer en el backlog."
        )
