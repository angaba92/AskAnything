# AskAnything — Cliente propio para Experience OS Agents (Dynamic Yield)

Interfaz propia que consume el mismo backend que el widget de "Experience OS
Agents" de Dynamic Yield. Permite lanzar consultas, ver las respuestas del
agente y **guardar/organizar tu historial localmente** (estados y tags), algo
que el widget oficial no ofrece.

> Herramienta interna. La sesión de DY y los datos viven en tu propio backend:
> Postgres (local o Vercel) y la cookie de sesión en la base de datos.

## Stack
- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- Prisma + PostgreSQL (local o gestionado: Neon / Vercel Postgres)

## Diagnóstico de KA en Batch

La pestaña **Bridge**, disponible incluso sin cargar un Excel, distingue la
detección de la extensión (PING) de una respuesta real de Knowledge Assistant y
del procesamiento de la app. **Check KA + app** envía una sola consulta mínima;
no hay consultas automáticas a KA. Las filas, Redo y el chat actualizan el mismo
indicador de esta pestaña del navegador. Los errores de transporte, autenticación
de la app y calidad de respuesta se muestran por separado.

El verde confirma únicamente la última petición completada, caduca a los 60
segundos y desaparece al iniciar otra petición o detectar un fallo. Otro PING
correcto no borra un fallo de KA. Se muestran fecha, duración y versión/transporte
de la extensión. En **localhost** se indica la ruta directa: el servidor local
llama a KA y no utiliza ni prueba el bridge. En la versión alojada, la respuesta
de la extensión pasa por `/api/ask` o `/api/chat` para su procesamiento.

## Puesta en marcha

```bash
npm install
cp .env.local.example .env.local   # y rellena los valores (ver abajo)
# Necesitas un Postgres (Neon, Vercel Postgres o Docker). Pon DATABASE_URL y
# DIRECT_URL en .env.local, luego crea las tablas:
npm run db:push                     # crea/actualiza las tablas en Postgres
npm run dev                         # http://localhost:3000
```

## Autenticación (opción A — paste manual)

El backend exige una **cookie de sesión** (tu login SSO + VPN) y un header
**`x-xsrf-token`**. Para el MVP los copias de tu navegador:

1. En la pestaña de DY ya logueado: `F12` → pestaña **Network**.
2. Lanza una pregunta cualquiera y abre el request `POST /agents/chats/...`.
3. En **Request Headers** copia:
   - el valor de `cookie` → `DY_COOKIE`
   - el valor de `x-xsrf-token` → `DY_XSRF_TOKEN`
   - el `sectionId` (o header `dy_section_id`) → `DY_SECTION_ID`
4. Pégalos en `.env.local` y reinicia `npm run dev`.

Cuando la sesión caduca verás un aviso de "Sesión caducada" en la UI con un
botón **"Refrescar sesión →"**. Ya no hace falta reiniciar: ver la sección
**"Refrescar la sesión DY sin reiniciar (equipo)"** más abajo.

## Refrescar la sesión DY sin reiniciar (equipo)

La cookie de DY es tu sesión SSO personal y **caduca cada pocas horas**. Para que
el equipo no se quede sin servicio, la cookie vigente se guarda en la **base de
datos** (tabla `Setting`, clave `dy_session`) y se actualiza **en caliente** —
sin reiniciar el servidor y funcionando también en serverless (Vercel).

Hay **dos formas** de refrescarla (lo hace una persona, normalmente Andrés):

**Opción A — Extensión de navegador (1 clic, recomendada)**

La cookie de sesión de DY es `HttpOnly`, así que un bookmarklet no puede leerla.
La extensión `extension/dy-session-capture` usa la API `chrome.cookies` para leer
la cookie completa (incluida la HttpOnly) y enviarla a la app:

1. Instala la extensión una vez (ver `extension/dy-session-capture/README.md` →
   `chrome://extensions` → *Developer mode* → *Load unpacked*).
2. Con DY abierto y logueado, pulsa el icono de la extensión, pon la URL de la
   app y **Capture & push session**. Listo.

**Opción B — Paste manual en `/settings`**

1. En DY (logueado), `F12` → **Network** → clic derecho en una llamada
   `/agents/chats/...` → **Copy → Copy as cURL**.
2. Abre **`/settings`** en la app → pega el cURL (o solo el header `cookie`) →
   **Guardar y probar**. La app extrae la cookie automáticamente y la valida
   contra DY.

Prioridad de lectura: BD (`Setting.dy_session`) → `.env.local` (`DY_COOKIE`).
La cookie nunca se expone al navegador (todo server-side).

## Deploying to Vercel

La app ya está lista para Vercel (con la migración a Postgres). Pasos:

1. **Crea una base de datos Postgres.** En el dashboard de Vercel →
   *Storage* → **Create Database → Postgres** (o usa Neon). Copia las dos URLs
   de conexión: la *pooled* (para `DATABASE_URL`) y la *direct/unpooled* (para
   `DIRECT_URL`). Si tu proveedor solo da una, pon la misma en ambas.
2. **Configura las variables de entorno** en *Project Settings → Environment
   Variables* (Production y Preview):
   - `DATABASE_URL`, `DIRECT_URL` — Postgres (paso 1).
   - `DY_BASE_URL` = `https://adm.dynamicyield.com`
   - `DY_SECTION_ID` = tu id de sección.
   - `DY_COOKIE` — **opcional** (fallback); lo normal es refrescarla luego desde
     `/settings` o la extensión.
   - `DEMO_AUTH_USERS` = `user1:pass1,user2:pass2` — login Basic Auth (ver abajo).
   - (Opcional) `AZURE_*`, `GITHUB_MODELS_TOKEN`, etc. si usas Copilot/KB.
   - **No** subas secretos al repo: todo va en estas variables.
3. **Deploy.** El script `vercel-build` ejecuta
   `prisma generate && prisma db push && next build`, así que las tablas se
   crean/actualizan solas en el primer despliegue.
4. **Refresca la sesión DY** una vez desplegado: abre `/settings` (o usa la
   extensión apuntando a la URL de Vercel) y guarda la cookie.

### Login de la demo (cómo probarlo)

El `middleware.ts` aplica **Basic Auth** a toda la app cuando defines usuarios.
Corre en el *edge* de Vercel, así que protege todas las visitas.

- **En local:** en `.env.local` pon `DEMO_AUTH_USERS="ana:1234,luis:abcd"` y
  prueba:
  ```bash
  curl -i http://localhost:3000           # 401 (pide credenciales)
  curl -i -u ana:1234 http://localhost:3000   # 200
  ```
  En el navegador aparece el pop-up nativo de usuario/contraseña.
- **En Vercel:** define `DEMO_AUTH_USERS` en *Environment Variables*. Al abrir la
  URL, el navegador pedirá usuario/contraseña a cada revisor. Sin la variable, el
  login se desactiva (la app queda abierta).

> Nota: el almacén de sesión ya **no** usa fichero (`.dy-session.json`); vive en
> Postgres, por lo que persiste correctamente en el FS efímero de Vercel.

## Plantilla de respuesta del agente (Summary / Details / References)

El chat principal pide al agente que estructure SIEMPRE su respuesta en tres
secciones:

- **Summary** — respuesta high level y positiva dentro de lo posible.
- **Details** — desarrollo con puntos clave: cómo se hace, qué se consigue, ejemplo.
- **References** — enlaces a los artículos / documentación de apoyo.

La plantilla vive en `src/lib/promptTemplate.ts`. Se envuelve la pregunta antes de
enviarla a DY y se limpia del mensaje humano que se muestra/guarda (la pregunta
aparece limpia en el chat). Para desactivarla: `DY_STRUCTURED_ANSWERS="false"`.


## Endpoints que usa (reverse-engineered del HAR)
| Acción | Llamada a DY |
|---|---|
| Crear thread | `POST /agents/chats/new` |
| Enviar mensaje | `POST /agents/chats/{threadId}` |
| Leer historial | `GET /agents/chats/{threadId}` |

## Estructura
```
src/
  lib/
    dyClient.ts   # llamadas al backend DY (server-side, inyecta auth)
    db.ts         # Prisma client
    persist.ts    # upsert de mensajes en la BD (Prisma/Postgres)
    types.ts      # tipos compartidos
  app/
    api/
      chat/route.ts             # enviar mensaje
      threads/route.ts          # listar (GET) / actualizar estado-tags (PATCH)
      threads/new/route.ts      # crear thread
      threads/[id]/route.ts     # detalle + sync
    page.tsx                    # dashboard (sidebar + chat)
  components/
    Sidebar.tsx
    MessageBubble.tsx
prisma/schema.prisma            # Thread + Message
```

## Red corporativa (certificados / registro)

El proxy de Mastercard intercepta TLS con un certificado propio. Si ves errores
tipo `self-signed certificate in certificate chain` (al instalar o al llamar a
DY), ejecuta apuntando Node al certificado corporativo:

```bash
export NODE_EXTRA_CA_CERTS="$HOME/.node-certificates/artifacts_mastercard_int-full-chain.pem"
npm run dev
```

- El **registro npm corporativo** (`artifacts.mastercard.int`) solo es accesible
  dentro de la VPN. Sin VPN, instala desde el público:
  `npm install --registry=https://registry.npmjs.org/`.
- Las llamadas al backend de DY también pasan por el proxy: el `NODE_EXTRA_CA_CERTS`
  de arriba permite que el `fetch` a `adm.dynamicyield.com` confíe en la cadena.

## Internal Demo Sharing (compartir para revisión interna)

> Objetivo: que tus managers prueben el flujo de revisión de RFP/Loopio y den
> feedback **sin publicar una URL pública** y **sin commitear secretos**.

### Qué opción usamos y por qué

| Opción | ¿Sirve para este repo? | Veredicto |
|---|---|---|
| **1. Azure Static Web Apps + Entra ID** | ❌ La app **no es estática**: tiene API routes (`/api/*`) y base de datos. SWA es para front estático + Functions; habría que reescribir el backend. | Descartada |
| **1b. Azure App Service (Node) + Entra Easy Auth** | ✅ Correcta y con login Entra (solo usuarios Mastercard concretos), pero **requiere IT** (suscripción, app registration, permisos de deploy). | Mejor opción "oficial" — *Requires IT/Admin* |
| **2. Túnel autenticado (ngrok/cloudflared)** | ⚠️ Da una URL en DNS público (aunque con Access). Además compartiría **tu** sesión DY. La red corporativa suele bloquearlo. | Evitar |
| **3. Codespaces / Dev Containers** | ⚠️ Requiere subir el repo a GitHub + Codespaces habilitado por la org + dar acceso a cada revisor. | Solo si ya usáis Codespaces |
| **4. Ejecución local + gate de contraseña** | ✅ Cero admin, cero exposición pública. La demo de `/kb` funciona **sin secretos** (BM25 local). | ✅ **Recomendada para empezar hoy** |

**Recomendación:** empieza con la **Opción 4** (rápida, sin IT). Cuando quieras
una URL interna estable y login corporativo, escala a la **Opción 1b** (abajo,
*Requires IT/Admin*).

### Seguridad de secretos (importante)
- La app **no usa ninguna variable `NEXT_PUBLIC_*`**: ningún secreto llega al
  navegador. `DY_COOKIE`, `GITHUB_MODELS_TOKEN` y `AZURE_*` se usan **solo
  server-side**. No hace falta mover nada.
- **No compartas tu `.env.local`**: el `DY_COOKIE` es **tu sesión personal**. La
  demo de revisión RFP (`/kb`) **no lo necesita** — funciona 100% local con BM25.
- `.env.local` está en `.gitignore`. Nunca se commitea.

### Opción 4 — pasos para TI (el que comparte)

1. Activa el **login inicial estilo .htaccess** (HTTP Basic Auth) en `.env.local`.
   Para un equipo, usa varios usuarios (formato `user:pass`):
   ```bash
   DEMO_AUTH_USERS="ana:Clave-larga-1,luis:Clave-larga-2"
   ```
   O un único usuario compartido:
   ```bash
   DEMO_AUTH_USER="demo"
   DEMO_AUTH_PASSWORD="elige-una-larga-aqui"
   ```
   Si lo dejas todo vacío, el login se desactiva (dev normal). Implementado en
   `src/middleware.ts` (protege páginas **y** API).
2. (Opcional, recomendado) deja `GITHUB_MODELS_TOKEN=""` y `DY_COOKIE=""`: la
   demo de `/kb` funciona sin ellos en modo *Local match*.
3. Arranca la app accesible en tu red/VPN corporativa:
   ```bash
   npm run demo        # next build && next start -H 0.0.0.0 -p 3000
   ```
4. Comparte por chat interno tu **IP de la red corporativa** y las credenciales:
   - URL: `http://TU_IP_INTERNA:3000/kb`  (averíguala con `ipconfig getifaddr en0`)
   - Usuario / contraseña: los de `DEMO_AUTH_USERS` / `DEMO_AUTH_*`.
5. Para revocar acceso: quita el usuario de `DEMO_AUTH_USERS` y reinicia.

> **¿Apache delante?** Si sirves la app detrás de Apache como reverse proxy,
> tienes un `.htaccess` real + `.htpasswd.example` en `deploy/apache/`. En ese
> caso el login lo hace Apache y no necesitas las variables `DEMO_AUTH_*`.

> Alternativa "cada revisor en su máquina": comparte el repo (sin `.env.local`),
> y que ejecuten `npm install && npm run db:push && npm run dev`, entrando a
> `/kb`. Sin secretos, sin red compartida.

### Opción 4 — pasos para los REVISORES
- Abrir `http://TU_IP_INTERNA:3000/kb` (mismo VPN/red que tú).
- Introducir usuario/contraseña en el login inicial.
- Probar: subir un Excel/PDF de Q&A en **Knowledge base (RFP)** y hacer preguntas;
  dejar feedback del flujo.

### ¿Dónde van las variables de entorno?
- **Local (Opción 4):** en `.env.local` (ver `.env.local.example`). Nunca en git.
- **Login `.htaccess` (Apache):** `.htpasswd` fuera del docroot (ver
  `deploy/apache/`). Gitignored.
- **Azure App Service (Opción 1b):** en **Configuration → Application settings**
  del App Service (no en el código). Easy Auth se configura en el portal, no por env.

---

### Opción 1b — Azure App Service + Entra ID  *(Requires IT/Admin action)*

Para una URL interna estable con **login corporativo** (acceso limitado a
usuarios/grupos Mastercard concretos). Pide a IT/Cloud:

1. **App Service (Linux, Node 20)** en la suscripción del equipo. Plan B1 basta.
   - Despliegue: build `npm run build` (ya genera `output: "standalone"`), o
     contenedor. Start command: `node server.js` (carpeta `.next/standalone`).
2. **Restringir acceso de red** (elige una): integración con VNet/Private
   Endpoint, o **Access Restrictions** por rango IP corporativo.
3. **Authentication (Easy Auth) con Microsoft Entra ID:**
   - **App registration** (single-tenant, tenant de Mastercard).
   - **Redirect URI:** `https://<nombre-app>.azurewebsites.net/.auth/login/aad/callback`
   - **Token store:** habilitado. **"Require authentication"** = sí; acción para
     no autenticados = *Return HTTP 302 (login)*.
   - **Acceso limitado:** asignar la app a un **grupo/Enterprise Application** con
     solo tus managers, y activar *User assignment required = Yes*.
4. **Application settings (secrets server-side, NO en git):**
   `DY_COOKIE` (opcional), `GITHUB_MODELS_TOKEN` (opcional), `DEMO_AUTH_*` (déjalos
   vacíos: con Entra el gate Basic ya no hace falta).
5. **Persistencia:** la app usa Postgres (`DATABASE_URL`/`DIRECT_URL`), así que
   los datos persisten igual en App Service. Apunta esas variables a tu Postgres
   gestionado (Neon / Azure Database for PostgreSQL).

**Resumen de lo que pedir a IT:** App Service Linux Node 20 + App Registration
single-tenant con el redirect URI de arriba + Easy Auth (require auth) + grupo de
usuarios asignado + access restriction a IP/VNet corporativa.



## Roadmap
