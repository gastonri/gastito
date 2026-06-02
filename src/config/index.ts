// Bun has built-in support for .env files, no need for dotenv

export const config = {
  telegram: {
    token: process.env.TELEGRAM_TOKEN || "",
    chatId: parseInt(process.env.TELEGRAM_CHAT_ID || "0", 10),
    partnerChatId: process.env.TELEGRAM_PARTNER_CHAT_ID ? parseInt(process.env.TELEGRAM_PARTNER_CHAT_ID, 10) : null,
    webhookUrl: process.env.WEBHOOK_URL || "",
    userNames: Object.fromEntries(
      (process.env.TELEGRAM_USER_NAMES || "")
        .split(",")
        .filter(Boolean)
        .map((entry) => {
          const [id, ...nameParts] = entry.trim().split(":");
          return [id.trim(), nameParts.join(":").trim()];
        })
    ) as Record<string, string>,
  },
  ai: {
    defaultProvider: (
      process.env.DEFAULT_AI_PROVIDER ||
      process.env.AI_PROVIDER ||
      "gemini"
    ).toLowerCase(), // "gemini" or "anthropic"
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || "",
      modelName: process.env.GEMINI_MODEL_NAME || "gemini-2.5-flash",
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || "",
      modelName: process.env.ANTHROPIC_MODEL_NAME || "claude-haiku-4-5-20251001",
    },
  },
  sheets: {
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "",
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || "",
  },
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
    nodeEnv: process.env.NODE_ENV || "production",
  },
  redis: {
    url: process.env.REDIS_URL || "",
  },
};

// Validate required configuration
const requiredVars = ["TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID", "GOOGLE_SHEETS_SPREADSHEET_ID"];

// Validate AI provider specific keys (check both providers since users can switch)
if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Missing required environment variable: At least one of GEMINI_API_KEY or ANTHROPIC_API_KEY must be set"
  );
}

// Validate default provider
if (config.ai.defaultProvider !== "gemini" && config.ai.defaultProvider !== "anthropic") {
  throw new Error(
    `Invalid DEFAULT_AI_PROVIDER: ${config.ai.defaultProvider}. Must be "gemini" or "anthropic"`
  );
}

// Validate default provider has API key
if (config.ai.defaultProvider === "gemini" && !process.env.GEMINI_API_KEY) {
  throw new Error(
    "Missing required environment variable: GEMINI_API_KEY (required for default provider)"
  );
} else if (config.ai.defaultProvider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Missing required environment variable: ANTHROPIC_API_KEY (required for default provider)"
  );
}

for (const varName of requiredVars) {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
}

// Validate Redis URL for session management
if (!process.env.REDIS_URL) {
  throw new Error(
    "Missing required environment variable: REDIS_URL (required for session management)"
  );
}
