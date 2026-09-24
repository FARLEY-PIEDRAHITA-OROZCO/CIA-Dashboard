# 06 · Seguridad

> Riesgos, controles y checklist del proyecto. Aplica para **todos** los devs
> que toquen el código, especialmente el manejo del secreto (PAT) y la
> inyección de contenido (HTML de Azure).

---

## 1. Modelo de amenazas (resumen ejecutivo)

| Amenaza | Superficie | Mitigación implementada |
| ------- | ---------- | ----------------------- |
| **Fuga del PAT** | `.env`, logs, respuestas, git | solo en `.env` (gitignore), `repr=False`, nunca en logs/respuestas, header de auth en un único punto |
| **XSS** por descripción HTML de Azure | render en el dashboard | sanitización con DOMPurify, denylist de etiquetas activas/recursos y `FORBID_ATTR`; sin `dangerouslySetInnerHTML` directo |
| **SSRF / abuso del proxy** | endpoints de la API | la app NO acepta URLs del usuario; las rutas a Azure son 100% fijas en código |
| **Leak de datos por CORS** | navegadores | CORS cerrado al origen del frontend + `http://{host}:{puerto}`; métodos `GET/POST`; headers mínimos |
| **Exposición si se abre a red externa** | listener | por defecto bind en `127.0.0.1` (solo local); documentado cómo exponer con reverse proxy + auth (ver §6) |
| **Deserialización / tipos** | API | todos los modelos Pydantic tipan campos y validan tipos al entrar |
| **Inyección WIQL** | nombre del ÁreaPath | escape de comillas simples (`'` → `''`) |

---

## 2. Manejo del secreto (PAT)

Reglas **obligatorias**:

1. **Único lugar**: `backend/.env` (variable `AZURE_PAT`). La plantilla
   pública es `backend/.env.example` y **no** contiene el valor.
2. **Git**: `.env`, `.env.*` y `backend/.env` están ignorados; `.env.example`
   queda permitido. Antes de cada commit verificar: nunca stagear un `.env`; si
   ocurre, purgar del historial y rotar el PAT de inmediato.
3. **No en logs**: `Settings` declara `azure_pat` con `repr=False`; el
   transporte no imprime headers ni la URL completa con credenciales. El
   `AzureError` solo expone estado y un mensaje seguro; el cuerpo upstream no
   se devuelve ni se registra automáticamente.
4. **No en la API**: ningún esquema de respuesta (`schemas.py`) contiene el
   PAT. El frontend jamás debería recibirlo (los endpoints de estado
   devuelven solo `configurada: true/false`).
5. **Scope mínimo**: PAT con **Work Items → Read** (hacer el dashboard no
   requiere escritura). Un PAT expuesto debe rotarse.
6. **`httpx.AsyncClient` con timeout**: evita conexiones colgadas; el cierre
   se hace en el `lifespan` de FastAPI.

---

## 3. Sanitización de contenido (`frontend/src/componentes/ContenidoRico.tsx`)

Azure guarda `System.Description` como HTML. El frontend es la única frontera
de render:

```ts
DOMPurify.sanitize(html || "", {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["form", "input", "button", "img", "video", "audio", "iframe"],
  FORBID_ATTR: ["style", "srcset", "formaction"],
});
```

Qué garantiza:

- Se eliminan **scripts, eventos (`on...`), `<iframe>`, `<javascript:`**, etc.
- Se prohiben atributos `style` (`FORBID_ATTR`) — los estilos inline de Azure
  (fuentes, tamaños de 13.3333px) desaparecen en favor del diseño propio.
- `dangerouslySetInnerHTML` solo se usa **una vez**, dentro de
  `<ContenidoRico>`, y solo sobre el resultado ya sanitizado.

Reglas de código:

- **Prohibido** inyectar `epica.descripcion` con `innerHTML`/`dangerously...`
  fuera de `ContenidoRico`.
- Si mañana se agrega rich-text, mantener sanitización antes de la inyección.

> Ver mutación/confirmación en las pruebas de `ContenidoRico.test.tsx`
> ([07-pruebas](07-pruebas.md)).

---

## 4. CORS y transporte

Definido en `main.py`:

```python
allow_origins = [f"http://{cfg.host}:{cfg.puerto}"] + cfg.origenes_cors
allow_methods = ["GET", "POST"]
allow_headers = ["Authorization", "Content-Type"]
```

- La API añade `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy` y `Cache-Control: no-store`.
- En producción, cuando el frontend se sirve del mismo backend (mismo
  origen), CORS no interviene.
- En desarrollo, el proxy de Vite evita el cross-origin real; el origen
  permitido por defecto (`http://127.0.0.1:8000`) cubre pruebas directas.
- Si se sirven desde puertos distintos, agregar el origen en `ORIGEN_CORS`
  (`config.py`), no abrir CORS a `*`. `CORS` no es autenticación ni rate limiting.

---

## 5. Higiene de CI / git

Checklist antes de commitear (todo el equipo):

- [ ] ¿Algún archivo `.env`, clave o token en `git status` / `git diff`?
- [ ] `git check-ignore backend/.env` devuelve el archivo (está ignorado)
- [ ] ¿Alguna respuesta o log nuevo incluye el PAT? (no debe)
- [ ] `npm.cmd test` y `pytest` en verde
- [ ] Build del frontend OK (`npm.cmd run build`)
- [ ] `npm.cmd audit` completo revisado; el resultado actual es 0 vulnerabilidades.
- [ ] `git diff`/historial revisado cuando exista metadata Git; este workspace actual no tiene `.git`.

Herramienta de verificación rápida de secretos:

```powershell
git log -S "AZURE_PAT" --oneline            # commits que tocaron la variable
Test-Path backend/.env                       # presencia local (nunca subir)
```

---

## 6. Cómo exponer esta app más allá de localhost (cuando toque)

El proyecto está pensado para **uso local/equipo**. No existe autenticación
propia, rate limiting ni readiness; la aplicación solo añade headers básicos
de seguridad y rechaza bindings externos sin `PERMITIR_EXTERNO=true`. Antes
de exponerlo:

1. **Reverse proxy con TLS** (p. ej. nginx/Caddy) terminando HTTPS; redirigir
   HTTP → HTTPS.
2. **Autenticación** en el proxy (OIDC/Basic con lista de usuarios), porque
   esta app **no tiene login propio** (la autenticación la hace Azure vía PAT
   del backend).
3. Portar el secreto fuera de variables literales: secret manager/`getSecret`
   en el entorno de despliegue (ver [08-despliegue](08-despliegue.md)).
4. Considerar **limitación de rate** en el proxy (los endpoints son de solo
   lectura con caché).
5. Quitar/limitar `/docs` (Swagger) si no se desea público.

Nunca exponer el backend directamente con bind `0.0.0.0` sin auth.

---

## 7. Datos sensibles del negocio

- El dashboard lee **solamente** IDs, títulos, estados, descripciones y URLs de
  work items. No expone nada fuera de esos campos (los schemas filtran).
- Los schemas no incluyen el PAT, pero un `Settings.model_dump()` explícito
  sí contendría el valor: nunca serializar el objeto completo.
- `LOG_NIVEL` se aplica tanto a Uvicorn como al logger de la aplicación;
  el transporte no tiene logging DEBUG propio.

---

Siguiente lectura: [07 · Pruebas](07-pruebas.md).