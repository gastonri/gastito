# Gastito

Bot de Telegram para registrar gastos personales usando IA (Google Gemini). Procesa texto, imágenes de tickets y mensajes de voz para extraer gastos y guardarlos en Google Sheets.

> Fork de [budgetify](https://github.com/dbrosio3/budgetify) creado por [@dbrosio3](https://github.com/dbrosio3). Gracias por el trabajo base!

## Features

- 📝 Registrar gastos por mensaje de texto
- 📸 Analizar fotos de tickets/facturas con Gemini Vision
- 🎤 Transcribir y procesar mensajes de voz
- 💾 Guardar gastos en Google Sheets
- 🔄 Contexto conversacional para mensajes de seguimiento
- ✅ Botones de confirmar/cancelar antes de guardar
- 👤 Soporte para múltiples usuarios (ej: pareja) con whitelist por chat ID
- 💸 Campo `mi_parte` (0-100%) para gastos compartidos
- 💱 Gastos en USD convertidos con dólar tarjeta (automático) o blue, con botón para cambiarlo antes de confirmar
- 🏷️ Botón para cambiar la categoría antes de confirmar
- 📊 Porcentaje del presupuesto del mes del gasto después de cada registro
- ↩️ `/deshacer` para borrar lo último confirmado, y aviso de posibles duplicados
- 📈 `/resumen`, `/grafico`, `/comparar` y `/presupuesto` (ver `/ayuda` en el bot)

## Estructura del Spreadsheet

El script `bun run setup` crea las hojas base (`GASTOS`, `INGRESOS`, `CONFIG`). Las hojas auxiliares de abajo se crean a mano.

### Hoja GASTOS

| A: fecha | B: persona | C: descripcion | D: macro_categoria | E: subcategoria | F: monto | G: moneda | H: cuotas | I: n_cuota | J: imp_mensual | K: mi_parte_% | L: link | M: notas | N: año | O: mes | P: dia | Q: tipo_cambio |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

La app escribe solo los datos de entrada. `imp_mensual` (J) y año, mes, día (N:P) son **fórmulas** que se copian
de la fila 2 de la hoja `PLANTILLA_GASTOS`. `tipo_cambio` (Q) es la cotización en pesos usada para un gasto en USD.
Cada gasto se escribe en una sola operación atómica. Detalle en [`docs/SHEETS.md`](docs/SHEETS.md).

### Hojas auxiliares

| Hoja | Para qué |
|---|---|
| `PLANTILLA_GASTOS` | Fila 2 con las fórmulas que se copian a cada gasto nuevo. No mover ni borrar. |
| `Dolar Tarjeta`, `Dolar Blue` | Cotización diaria (fecha, precio) que llena un Google Apps Script. |
| `PRESUPUESTOS` | Presupuesto mensual por categoría. |
| `CUADERNO_CONTABLE` | Ingresos, gastos y neto por mes. |

Un Google Apps Script mantiene `GASTOS` ordenada por fecha y trae las cotizaciones del dólar.
El código está en [`apps-script/`](apps-script/README.md) y hay que copiarlo a mano en la planilla.

### Hoja INGRESOS

| A: fecha | B: persona | C: descripcion | D: categoria | E: monto | F: moneda | G: link | H: notas |
|---|---|---|---|---|---|---|---|

Categorías de ingreso: Sueldo, Freelance/Changas, Alquiler cobrado, Inversiones/Intereses, Reembolso, Regalo, Venta, Otro.

### Hoja CONFIG

| A: macro_categoria | B: subcategoria |

### Categorías por defecto

| Macro | Subcategorías |
|---|---|
| ALIMENTACIÓN | Supermercado, Restaurante, Café y Snacks, Delivery, Verdulería, Carnicería y Pollería, Kiosco |
| VIVIENDA | Servicios, Mantenimiento/Reparaciones, Mobiliario/Decoración |
| TRANSPORTE | Combustible, Transporte público, Taxi/Uber, Viajes, Mantenimiento vehículo, Estacionamiento, Peajes |
| SALUD | Farmacia, Obra Social/Prepaga, Consultas médicas, Odontología, Deporte/Gym |
| EDUCACIÓN | Cursos/Capacitaciones, Libros/Materiales, Cuota colegio/universidad, Idiomas |
| TECNOLOGÍA | Suscripciones digitales, Software/Licencias, Hardware/Electrónica, Telefonía/Celular |
| ENTRETENIMIENTO | Cine/Teatro/Shows, Hobbies, Viajes/Turismo, Salidas/Recreación |
| INDUMENTARIA | Ropa, Calzado, Accesorios, Peluquería/Estética |
| HOGAR | Limpieza/Productos, Mercadería no alimenticia, Jardinería |
| FINANZAS | Impuestos, Seguros, Comisiones bancarias, Inversiones, Asesoría financiera |
| REGALOS Y DONACIONES | Regalos, Donaciones, Eventos/Celebraciones |
| MASCOTAS | Veterinario, Alimento, Accesorios |

## Prerequisites

- [Bun](https://bun.sh) (latest version)
- Redis (local con Docker o Upstash para producción)
- Google Cloud Service Account con Sheets API habilitada
- Token de Telegram Bot
- Google Gemini API Key
- ID de Google Sheets Spreadsheet

## Setup

1. **Instalar Bun** (si no está instalado):
```bash
curl -fsSL https://bun.sh/install | bash
```

2. **Clonar e instalar dependencias:**
```bash
bun install
```

3. **Configurar variables de entorno:**
```bash
cp .env.example .env
```

Variables requeridas:

| Variable | Descripción |
|---|---|
| `TELEGRAM_TOKEN` | Token del bot de Telegram |
| `TELEGRAM_CHAT_ID` | Tu chat ID (whitelist principal) |
| `WEBHOOK_URL` | URL pública del servidor |
| `GEMINI_API_KEY` | Google Gemini API key (o `GEMINI_API_KEYS`, ver abajo) |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | ID de la spreadsheet |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path al JSON de service account |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | O bien, el JSON como string (para producción) |
| `REDIS_URL` | URL de Redis |

Variables opcionales:

| Variable | Descripción |
|---|---|
| `TELEGRAM_PARTNER_CHAT_ID` | Chat ID de la pareja (agrega al whitelist) |
| `TELEGRAM_USER_NAMES` | Mapeo `chatId:Nombre,...` para el campo persona |
| `DEFAULT_AI_PROVIDER` | `gemini` (default) o `anthropic` |
| `GEMINI_API_KEYS` | Varias keys separadas por coma. Tiene prioridad sobre `GEMINI_API_KEY` y rota si una llega al límite de cuota |
| `GEMINI_MODEL_NAME` | Modelo de Gemini (default `gemini-3.6-flash`) |
| `GEMINI_THINKING_LEVEL` | Nivel de razonamiento (default `minimal`; vacío usa el del modelo). `minimal` no lo soportan todos los modelos |
| `GEMINI_TIMEOUT_MS` | Espera máxima por una llamada de texto antes de reintentar con la otra key (default 12000) |
| `GEMINI_HEAVY_TIMEOUT_MS` | Lo mismo para fotos y audios (default 45000) |
| `GEMINI_RATE_LIMIT_COOLDOWN_MS` | Pausa de una key al llegar al límite (default 60000) |

4. **Iniciar Redis para desarrollo local:**
```bash
docker-compose up -d
```

5. **Crear las hojas en el Spreadsheet:**
```bash
bun run setup
```

6. **Correr el servidor:**
```bash
bun run dev
```

## Deployment en Northflank

El bot está desplegado en [Northflank](https://northflank.com). **Pushear a `main` dispara el deploy.**

Las variables de entorno se configuran desde el panel de Northflank. Asegurarse de tener:
- Todas las variables de la tabla de arriba
- `WEBHOOK_URL` apuntando al dominio de Northflank
- `GOOGLE_SERVICE_ACCOUNT_JSON` con el JSON del service account (en vez de `GOOGLE_APPLICATION_CREDENTIALS`)

Si no se define `GEMINI_MODEL_NAME`, se usa el modelo por defecto del código. Google da de baja modelos
viejos para cuentas nuevas (pasó con `gemini-2.5-flash`), así que conviene revisar los logs si el bot deja de analizar.

## Logs

Los eventos estructurados (`EVENT ...`) muestran tiempos por etapa, llamadas a Gemini y la causa de cada error.
Ver [`docs/LOGS.md`](docs/LOGS.md) para los eventos y búsquedas útiles.

## Estructura del proyecto

```
gastito/
├── src/
│   ├── config/          # Variables de entorno
│   ├── bot/             # Handlers de Telegram
│   ├── ai/              # Cliente Gemini/Anthropic
│   ├── sheets/          # Cliente Google Sheets
│   ├── services/        # Lógica de negocio
│   ├── types/           # TypeScript types
│   ├── utils/           # Logger, formato, números, tiempos
│   └── server.ts        # Entry point Express
├── scripts/
│   ├── setup-sheets.ts  # Crea/recrea hojas en el Spreadsheet
│   ├── eval-prompts.ts  # Evals de los prompts contra Gemini
│   └── eval-report.ts   # Reporte HTML de los evals
├── evals/               # Casos de prueba de prompts y resultados (ignorados por git)
├── apps-script/         # Google Apps Script de la planilla (orden y dólar)
├── docs/                # SHEETS.md, LOGS.md y guías de deploy
├── legacy/              # Versiones anteriores en Google Apps Script
├── Dockerfile
└── fly.toml             # Config histórica de Fly.io; hoy se despliega en Northflank
```

## Comandos

| Comando | Descripción |
|---|---|
| `bun run dev` | Servidor local con hot reload |
| `bun run start` | Servidor de producción |
| `bun run setup` | Crea/recrea hojas GASTOS y CONFIG en el Spreadsheet |
| `bun run type-check` | Chequeo de tipos TypeScript |
| `bun run lint` | Lint |
| `bun test` | Tests |
| `bun run eval:prompts` | Evals de prompts (necesita una Gemini key válida; ver `scripts/eval-prompts.ts`) |

## License

MIT
