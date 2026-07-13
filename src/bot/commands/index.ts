import { CommandContext, CommandHandler } from "./types";
import { handleExit } from "./exit";
import { handleReset } from "./reset";
import { handleContexto } from "./contexto";
import { handleAyuda } from "./ayuda";
import { handleResumen } from "./resumen";
import { handleGrafico } from "./grafico";
import { handleComparar } from "./comparar";
import { handlePresupuesto } from "./presupuesto";
import { handleModel } from "./model";

const COMMANDS: [string, CommandHandler][] = [
  ["/exit", handleExit],
  ["/nuevo", handleReset],
  ["/reset", handleReset],
  ["/contexto", handleContexto],
  ["/ayuda", handleAyuda],
  ["/resumen", handleResumen],
  ["/grafico", handleGrafico],
  ["/comparar", handleComparar],
  ["/presupuesto", handlePresupuesto],
  ["/model", handleModel],
];

/**
 * Runs the handler for a recognized command. Returns false if the text
 * doesn't match any known command, so the caller can fall through to
 * normal message processing (AI parsing).
 */
export async function dispatchCommand(ctx: CommandContext): Promise<boolean> {
  for (const [prefix, handler] of COMMANDS) {
    if (ctx.text.startsWith(prefix)) {
      await handler(ctx);
      return true;
    }
  }
  return false;
}

export type { CommandContext } from "./types";
