// Telegram Types
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
  };
  text?: string;
  photo?: TelegramPhoto[];
  voice?: TelegramAudio;
  audio?: TelegramAudio;
  caption?: string;
}

export interface TelegramPhoto {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  file_size?: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from: {
    id: number;
    is_bot: boolean;
    first_name: string;
  };
  message: TelegramMessage;
  data: string;
}

// Transaction Types
export type TransactionType = "GASTO";
export type Moneda = "ARS" | "USD";
export type Confianza = "ALTA" | "MEDIA" | "BAJA";

// Valid options arrays (use these for prompts and validation)
export const MONEDA_OPTIONS: readonly Moneda[] = ["ARS", "USD"] as const;

export interface TransactionData {
  fecha?: string;
  persona?: string;
  descripcion?: string;
  macro_categoria?: string;
  subcategoria?: string;
  monto?: number;
  moneda?: Moneda;
  cuotas?: number;
  n_cuota?: number;
  mi_parte?: number;
  link?: string;
  notas?: string;
}

export interface TransactionResult {
  tipo: TransactionType;
  datos: TransactionData;
  confianza?: Confianza;
  campos_faltantes?: string[];
  razonamiento?: string;
  alerta?: string;
  usa_contexto?: boolean;
}

// Context Types
export interface ConversationContext {
  tipo: TransactionType;
  datos: TransactionData;
}

// Config Types
export interface CategoryMap {
  [macroCategory: string]: string[];
}

export interface ConfigData {
  macroCategorias: string[];
  subcategorias: string[];
  categoriasMap: CategoryMap;
}

// Image/Audio Processing Types
export interface ImageData {
  data: string; // base64
  mimeType: string;
}

export interface AudioData {
  data: string; // base64
  mimeType: string;
}

// Pending Operation Types
export interface PendingOperation {
  operationId: string;
  data: TransactionResult;
  timestamp: number;
}

// API Response Types
export interface TelegramAPIResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

export interface TelegramMessageResponse {
  message_id: number;
  chat: {
    id: number;
  };
}

export interface TelegramFileResponse {
  file_id: string;
  file_unique_id: string;
  file_path: string;
  file_size?: number;
}

// Gemini API Response Types
export interface GeminiErrorDetail {
  "@type"?: string;
  retryDelay?: string;
}

export interface GeminiError {
  code?: number;
  message?: string;
  status?: string;
  details?: GeminiErrorDetail[];
}

export interface GeminiContentPart {
  text?: string;
  inline_data?: {
    mime_type: string;
    data: string;
  };
}

export interface GeminiContent {
  parts: GeminiContentPart[];
}

export interface GeminiCandidate {
  content: GeminiContent;
}

export interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: GeminiError;
}

// Anthropic API Response Types
export interface AnthropicError {
  type?: string;
  message?: string;
  param?: string;
  code?: string;
}

export interface AnthropicContentBlock {
  type: string;
  text: string;
}

export interface AnthropicMessage {
  content: AnthropicContentBlock[];
}

export interface AnthropicResponse {
  content: AnthropicContentBlock[];
  error?: AnthropicError;
}

// Google Sheets API Types
export interface GoogleSheetsValueRange {
  range?: string;
  majorDimension?: string;
  values?: unknown[][];
}

export interface GoogleSheetsGetResponse {
  spreadsheetId?: string;
  valueRange?: GoogleSheetsValueRange;
  values?: unknown[][];
}

export interface GoogleSheetsAppendResponse {
  spreadsheetId?: string;
  tableRange?: string;
  updates?: {
    spreadsheetId?: string;
    updatedRange?: string;
    updatedRows?: number;
    updatedColumns?: number;
    updatedCells?: number;
  };
}

export interface GoogleSheetsUpdateResponse {
  spreadsheetId?: string;
  updatedRange?: string;
  updatedRows?: number;
  updatedColumns?: number;
  updatedCells?: number;
}

export interface GoogleSheetsBatchGetResponse {
  spreadsheetId?: string;
  valueRanges?: GoogleSheetsValueRange[];
}

export interface GoogleSheetsSheet {
  properties?: {
    sheetId?: number;
    title?: string;
    index?: number;
  };
}

export interface GoogleSheetsSpreadsheet {
  spreadsheetId?: string;
  properties?: {
    title?: string;
  };
  sheets?: GoogleSheetsSheet[];
}

// Session-Based Conversation Types

export type SessionState =
  | "idle"
  | "awaiting_clarification"
  | "awaiting_confirmation"
  | "processing";

export type QuestionType = "select" | "text";

export interface ClarificationQuestion {
  id: string;
  field: keyof TransactionData;
  questionText: string;
  questionType: QuestionType;
  options?: string[];
  currentValue?: string | number;
  confidence: Confianza;
}

export interface ConversationMessage {
  id: string;
  timestamp: number;
  role: "user" | "assistant";
  content: string;
  messageType?: "text" | "image" | "audio";
  attachments?: {
    transcription?: string;
    imageAnalysis?: string;
  };
}

// AI Response Discriminated Union
export interface AITransactionResponse {
  responseType: "transaction";
  transaction: TransactionResult;
  questions?: ClarificationQuestion[];
}

export interface AIClarificationResponse {
  responseType: "clarification";
  partialTransaction?: Partial<TransactionResult>;
  questions: ClarificationQuestion[];
  message: string;
}

export interface AIErrorResponse {
  responseType: "error";
  errorMessage: string;
  suggestions?: string[];
}

export type AIResponse =
  | AITransactionResponse
  | AIClarificationResponse
  | AIErrorResponse;

export interface ConversationSession {
  sessionId: string;
  chatId: number;
  state: SessionState;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  messages: ConversationMessage[];
  currentTransaction?: Partial<TransactionResult>;
  pendingQuestions?: ClarificationQuestion[];
  lastQuestionMessageId?: number;
  lastOperationId?: string;
}
