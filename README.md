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

## Estructura del Spreadsheet

El script `bun run setup` crea automáticamente las hojas necesarias.

### Hoja GASTOS

| A: fecha | B: persona | C: descripcion | D: macro_categoria | E: subcategoria | F: monto | G: moneda | H: cuotas | I: n_cuota | J: imp_mensual | K: mi_parte_% | L: link | M: notas |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

### Hoja CONFIG

| A: macro_categoria | B: subcategoria |

### Categorías por defecto

| Macro | Subcategorías |
|---|---|
| ALIMENTACIÓN | Supermercado, Restaurante, Café, Delivery, Verdulería, Carnicería |
| VIVIENDA | Alquiler, Servicios, Limpieza/Hogar |
| TRANSPORTE | Combustible, Transporte público, Taxi/Uber, Viajes |
| SALUD | Farmacia, Médico, Odontología |
| OCIO | Entretenimiento, Deporte/Gym, Libros |
| ROPA | Ropa, Calzado, Accesorios |
| TECNOLOGÍA | Electrónica, Suscripciones, Accesorios tech |
| EDUCACIÓN | Cursos, Instituto |

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
| `GEMINI_API_KEY` | Google Gemini API key |
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

El bot está desplegado en [Northflank](https://northflank.com). Para redeploy basta con pushear a `main`.

Las variables de entorno se configuran desde el panel de Northflank. Asegurarse de tener:
- Todas las variables de la tabla de arriba
- `WEBHOOK_URL` apuntando al dominio de Northflank
- `GOOGLE_SERVICE_ACCOUNT_JSON` con el JSON del service account (en vez de `GOOGLE_APPLICATION_CREDENTIALS`)

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
│   ├── utils/           # Logger
│   └── server.ts        # Entry point Express
├── scripts/
│   └── setup-sheets.ts  # Crea/recrea hojas en el Spreadsheet
├── legacy/              # Versiones anteriores en Google Apps Script
├── Dockerfile
└── fly.toml
```

## Comandos

| Comando | Descripción |
|---|---|
| `bun run dev` | Servidor local con hot reload |
| `bun run start` | Servidor de producción |
| `bun run setup` | Crea/recrea hojas GASTOS y CONFIG en el Spreadsheet |
| `bun run type-check` | Chequeo de tipos TypeScript |
| `bun run lint` | Lint |

## License

MIT
