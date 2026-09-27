"""Pruebas de la traducción de Azure para los activos de prueba.

La regla que más se rompe aquí es la del nombre de campo: la prioridad de un
caso de prueba **no** está en `System.Priority` (que devolvió vacío en los
3.431 casos medidos) sino en `Microsoft.VSTS.Common.Priority`. Y los pasos de
prueba no se piden nunca, porque son la causa de los errores HTTP 500.
"""

from app.infrastructure.azure import queries
from app.infrastructure.azure.queries import (
    CAMPOS_PRUEBA,
    RELACION_TESTED_BY,
    escapar_wiql,
    id_destino_de_relacion,
    requisitos_de_prueba,
    wiql_tipos,
)

BASE_REL = "https://dev.azure.com/org/proj/_apis/wit/workItems/"


def test_prioridad_de_caso_usa_el_nombre_microsoft():
    """`System.Priority` no existe en esta plantilla: sale vacío en 3.431 casos."""
    assert queries.CAMPO_PRIORIDAD == "Microsoft.VSTS.Common.Priority"


def test_los_pasos_de_prueba_no_se_piden():
    """Son la causa de los HTTP 500: el índice los excluye a propósito."""
    assert queries.CAMPO_TIENE_PASOS not in CAMPOS_PRUEBA
    assert queries.CAMPO_DESCRIPCION not in CAMPOS_PRUEBA


def test_el_indice_de_pruebas_si_pide_automatizacion():
    assert queries.CAMPO_AUTOMATIZACION in CAMPOS_PRUEBA
    assert queries.CAMPO_RAGON in CAMPOS_PRUEBA


def test_id_destino_tolera_query_strings():
    assert id_destino_de_relacion({"url": f"{BASE_REL}123"}) == 123
    assert id_destino_de_relacion({"url": f"{BASE_REL}123/"}) == 123
    assert id_destino_de_relacion({"url": f"{BASE_REL}123?foo=bar"}) == 123


def test_id_destino_ignora_lo_que_no_es_un_id():
    for url in ("", "https://example.com/adjuntos", f"{BASE_REL}abc", f"{BASE_REL}0"):
        assert id_destino_de_relacion({"url": url}) is None
    assert id_destino_de_relacion({}) is None
    assert id_destino_de_relacion(None) is None


def test_requisitos_solo_toma_tested_by():
    """Las demás relaciones (pasos compartidos, archivos) no hablan de cobertura."""
    item = {
        "relations": [
            {"rel": RELACION_TESTED_BY, "url": f"{BASE_REL}10"},
            {"rel": RELACION_TESTED_BY, "url": f"{BASE_REL}20"},
            {"rel": "System.LinkTypes.Related", "url": f"{BASE_REL}30"},
            {"rel": "Microsoft.VSTS.TestCase.SharedStepReferencedBy-Reverse", "url": f"{BASE_REL}40"},
            {"rel": "AttachedFile", "url": "https://example.com/x"},
        ]
    }
    assert requisitos_de_prueba(item) == [10, 20]


def test_requisitos_deduplica_y_ordena():
    """Un caso con dos enlaces al mismo requisito cubre uno, no dos."""
    item = {
        "relations": [
            {"rel": RELACION_TESTED_BY, "url": f"{BASE_REL}30"},
            {"rel": RELACION_TESTED_BY, "url": f"{BASE_REL}10"},
            {"rel": RELACION_TESTED_BY, "url": f"{BASE_REL}30"},
        ]
    }
    assert requisitos_de_prueba(item) == [10, 30]


def test_requisitos_sin_relaciones_devuelve_lista_vacia():
    assert requisitos_de_prueba({}) == []
    assert requisitos_de_prueba({"relations": None}) == []
    assert requisitos_de_prueba({"relations": []}) == []
    assert requisitos_de_prueba({"relations": ["basura", None, 42]}) == []


def test_escape_de_comillas_en_wiql():
    """Un tipo con apostrofe rompería la consulta si no se duplica."""
    assert escapar_wiql("Test's") == "Test''s"
    assert escapar_wiql("") == ""


def test_wiql_de_tipos_ordena_por_id():
    """El orden por id hace la carga determinista entre ejecuciones."""
    consulta = wiql_tipos(("Test Plan", "Test Case"))
    assert "IN ('Test Plan', 'Test Case')" in consulta
    assert consulta.endswith(f"ORDER BY [{queries.CAMPO_ID}]")
    assert "[System.TeamProject] = @project" in consulta


def test_wiql_sin_tipos_no_filtra_por_tipo():
    consulta = wiql_tipos(())
    assert "WorkItemType" not in consulta


def test_wiql_escapa_los_tipos():
    assert "''" in wiql_tipos(("Test's Case",))
