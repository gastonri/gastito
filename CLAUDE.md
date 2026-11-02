# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gastito Bot is a Telegram bot for financial transaction processing using AI. It analyzes text, receipt images, and voice messages to extract transaction data and stores it in Google Sheets.

**Tech Stack:** TypeScript, Bun runtime, Express.js, Google Gemini/Anthropic Claude AI

## Common Commands

```bash
bun run dev                    # Dev server with hot reload
bun run dev:staging            # Dev with staging env
bun run dev:production         # Dev with production env
bun run start                  # Production server
bun test                       # Run tests
bun run type-check             # TypeScript type checking
bun run lint                   # ESLint
bun run lint:fix               # ESLint with auto-fix
bun run format                 # Prettier format
bun run deploy                 # Legacy Fly.io deploy (production deploys by pushing to main)
```

No build step required - Bun runs TypeScript directly.

## Architecture

```
Request Flow:
Telegram → Express /webhook → Message Handler → AI Client → Sheets Client
                                    ↓
                            Context Manager (in-memory, 24h TTL)
                            Pending Operations (unconfirmed transactions)
                                    ↓
                            Callback Handler (confirm/cancel buttons)
                                    ↓
                            Final transaction → Google Sheets
```

### Key Directories

- `/src/ai/` - AI integration layer with provider abstraction (Gemini/Anthropic)
- `/src/bot/` - Telegram handlers, callbacks, and message formatting
- `/src/sheets/` - Google Sheets client for reading config and writing transactions
- `/src/services/` - Business logic: context management, validation, image/audio processing
- `/src/types/` - TypeScript interfaces
- `/src/config/` - Environment variable loading
- `/src/server.ts` - Express app entry point with webhook routing

### Key Patterns

- **Provider Pattern**: `AIClientManager` in `/src/ai/client.ts` abstracts Gemini and Anthropic implementations
- **Singleton Pattern**: `contextManager` and `pendingOperations` for in-memory state
- **Confirmation Workflow**: Transactions stored in pending state until user confirms via Telegram buttons

### Gemini notes

- `GEMINI_API_KEYS` (comma separated) takes priority over `GEMINI_API_KEY`; keys rotate only on HTTP 429.
- Default model is in `src/config/index.ts` (`gemini-3.6-flash`) and `GEMINI_THINKING_LEVEL` defaults to `minimal`; if the model rejects it the request is retried without it. A 404 "no longer available" means the model was retired for the key.
- Requests use the `v1beta` endpoint (needed for `thinkingConfig`).
- The webhook answers 200 immediately and processes in the background; repeated `update_id`s are ignored.
- Structured logs (`EVENT name key=value`) are documented in `docs/LOGS.md`.

### AI Provider System

Both providers implement the `AIClient` interface. Users can switch providers via `/model gemini|anthropic` command. Default provider set via `DEFAULT_AI_PROVIDER` env var.

### Google Sheets Structure

Sheets used: `CONFIG` (categories), `GASTOS` (expenses), `INGRESOS` (income), `PRESUPUESTOS`, `CUADERNO_CONTABLE`,
`Dolar Tarjeta` / `Dolar Blue` (daily rates) and `PLANTILLA_GASTOS` (row 2 holds the formulas copied to each new expense).

- One owner per column: the app writes inputs only; `imp_mensual` (J) and año/mes/dia (N:P) are sheet formulas.
- `writeGasto` must stay a **single atomic `batchUpdate`** (a sheet-side Apps Script sorts on every change and used to move rows between two writes). `/deshacer` finds rows by content, never by row number.
- To change a calculation, edit the formulas in `PLANTILLA_GASTOS` row 2 instead of the code. See `docs/SHEETS.md`.
- The Google Apps Script lives in `apps-script/` and is copied by hand into the spreadsheet.

## Key Environment Variables

```
TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, WEBHOOK_URL
GEMINI_API_KEY, GEMINI_MODEL_NAME
ANTHROPIC_API_KEY, ANTHROPIC_MODEL_NAME
GOOGLE_SHEETS_SPREADSHEET_ID
GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_JSON
DEFAULT_AI_PROVIDER (gemini|anthropic)
```

## Deployment

- **Northflank**: Production. Pushing to `main` deploys. (`fly.toml` is a historical Fly.io config.)
- **Render**: Free tier alternative (`render.yaml`) - uses UptimeRobot to keep awake
- Health endpoints: `/health` (simple), `/healthz` (detailed)
