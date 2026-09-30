import { ClosingStatus, formatBRL } from "@/lib/finance";

/** Texto do resultado, sempre com o valor que o explica. */
export function statusText(status: ClosingStatus | null, netCents: number, absCents: number): string {
  switch (status) {
    case "CORRETO":
      return "CAIXA CORRETO";
    case "FALTA":
      return `FALTA DE CAIXA: ${formatBRL(Math.abs(netCents))}`;
    case "SOBRA":
      return `SOBRA DE CAIXA: ${formatBRL(Math.abs(netCents))}`;
    case "MISTO":
      return `DIVERGÊNCIA COM FALTA E SOBRA (líquido ${formatBRL(netCents)}, soma das diferenças ${formatBRL(absCents)})`;
    default:
      return "CONFERÊNCIA INCOMPLETA";
  }
}

export function statusShort(status: ClosingStatus | null): string {
  switch (status) {
    case "CORRETO":
      return "Correto";
    case "FALTA":
      return "Falta";
    case "SOBRA":
      return "Sobra";
    case "MISTO":
      return "Falta e sobra";
    default:
      return "Pendente";
  }
}

export const SESSION_STATUS_LABEL: Record<string, string> = {
  OPEN: "Aberto",
  CLOSED: "Fechado",
  REOPENED: "Reaberto para correção",
  CORRECTED: "Fechado após correção",
};

export const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  VENDA: "Venda",
  FUNDO_ABERTURA: "Fundo de abertura",
  SUPRIMENTO: "Suprimento",
  SANGRIA: "Sangria",
  DESPESA: "Despesa",
  CANCELAMENTO: "Cancelamento",
  ESTORNO: "Estorno",
  AJUSTE: "Ajuste",
};

export const MOVEMENT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativo",
  VOIDED: "Anulado",
  CANCELLED: "Cancelado",
};

export const FLOAT_MODE_LABEL: Record<string, string> = {
  NEW_OPENING: "Nova abertura",
  TRANSFER: "Transferência de fundo entre turnos",
};
