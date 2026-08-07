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
bun run deploy                 # Deploy to Fly.io
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

### AI Provider System

Both providers implement the `AIClient` interface. Users can switch providers via `/model gemini|anthropic` command. Default provider set via `DEFAULT_AI_PROVIDER` env var.

### Google Sheets Structure

Required sheets: `CONFIG` (accounts, categories), `MIS_DATOS` (personal data), `GASTOS` (expenses), `INGRESOS` (income)

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

- **Fly.io**: Primary platform (`fly.toml`)
- **Render**: Free tier alternative (`render.yaml`) - uses UptimeRobot to keep awake
- Health endpoints: `/health` (simple), `/healthz` (detailed)
