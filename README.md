# Gastito

Bot de Telegram para registrar gastos personales usando IA (Google Gemini). Procesa texto, imágenes de tickets y mensajes de voz para extraer transacciones y guardarlas en Google Sheets.

> Fork de [budgetify](https://github.com/dbrosio3/budgetify) creado por [@dbrosio3](https://github.com/dbrosio3). Gracias por el trabajo base!

## Features

- 📝 Registrar gastos por mensaje de texto
- 📸 Analizar fotos de tickets/facturas con Gemini Vision
- 🎤 Transcribir y procesar mensajes de voz
- 💾 Guardar transacciones en Google Sheets
- 🔄 Contexto conversacional para mensajes de seguimiento
- ✅ Botones de confirmar/cancelar antes de guardar

## Prerequisites

- [Bun](https://bun.sh) (latest version)
- [Docker](https://www.docker.com) (para Redis local) o servidor Redis
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
Copiar `.env.example` a `.env` y completar los valores:
```bash
cp .env.example .env
```

Variables requeridas:
- `TELEGRAM_TOKEN` - Token del bot de Telegram
- `TELEGRAM_CHAT_ID` - Tu chat ID de Telegram (para seguridad)
- `GEMINI_API_KEY` - Google Gemini API key
- `GOOGLE_SHEETS_SPREADSHEET_ID` - ID de tu spreadsheet
- `GOOGLE_APPLICATION_CREDENTIALS` - Path al JSON de service account
  O bien
- `GOOGLE_SERVICE_ACCOUNT_JSON` - JSON del service account como string
- `REDIS_URL` - URL de Redis (ej: `redis://localhost:6379` para local)

4. **Iniciar Redis (para desarrollo local):**
```bash
docker-compose up -d
```

5. **Estructura del Spreadsheet:**
La spreadsheet debe tener estas hojas:
- `CONFIG` - Cuentas, categorías y subcategorías
- `MIS_DATOS` - Datos personales (nombre, aliases, CBU, CUIT)
- `GASTOS` - Hoja de gastos
- `INGRESOS` - Hoja de ingresos
- `TRANSFERENCIAS` - Hoja de transferencias

6. **Correr el servidor:**
```bash
bun run src/server.ts
```

Para desarrollo con hot reload:
```bash
bun --watch src/server.ts
```

**Nota:** Bun ejecuta TypeScript directamente, no hace falta compilar.

## Deployment en Fly.io

1. **Instalar Fly CLI:**
```bash
curl -L https://fly.io/install.sh | sh
```

2. **Login:**
```bash
fly auth login
```

3. **Deploy:**
```bash
fly deploy
```

4. **Configurar variables de entorno:**
```bash
fly secrets set TELEGRAM_TOKEN=your_token
fly secrets set TELEGRAM_CHAT_ID=your_chat_id
fly secrets set GEMINI_API_KEY=your_key
fly secrets set GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id
fly secrets set GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
fly secrets set WEBHOOK_URL=https://your-app.fly.dev
```

## Estructura del proyecto

```
gastito/
├── src/
│   ├── config/          # Configuración
│   ├── bot/             # Handlers de Telegram
│   ├── ai/              # Cliente de Gemini/Anthropic
│   ├── sheets/          # Cliente de Google Sheets
│   ├── services/        # Lógica de negocio
│   ├── types/           # TypeScript types
│   ├── utils/           # Utilidades (logger, errores)
│   └── server.ts        # Servidor Express
├── legacy/              # Versiones anteriores en Google Apps Script
├── package.json
├── tsconfig.json
├── Dockerfile
└── fly.toml
```

## Comandos

- `bun run dev` - Servidor de desarrollo con hot reload
- `bun run start` - Servidor de producción
- `bun test` - Tests
- `bun run type-check` - Chequeo de tipos
- `bun run lint` - Lint

## License

MIT
