// Tipos mínimos para os testes do sistema importarem a lógica do programa.
export const VERSION: string;
export const LIMITS: { turnos: number; vendas: number; bytes: number };
export function ident(name: string): string;
export function pickColumns(table: string, available: Record<string, string[]>): string[];
export function hashOf(value: unknown): string;
export function permissionScript(config: { mysql?: { user?: string; password?: string }; bases?: { loja: string; tempoReal?: string }[] }): string;
export type Row = Record<string, unknown>;
export interface Turno { codigo: string; aberto: boolean; vendas: Row[]; sangrias: Row[]; [k: string]: unknown }
export function buildTurno(turno: Row, pagamentos: Row[], detalhes: Row[], sangrias: Row[], opts?: { open?: boolean; prefix?: string; establishment?: string | null }): Turno;
export function chunkTurnos(turnos: Turno[], limits?: { turnos: number; vendas: number; bytes: number }): Turno[][];
export type Query = (sql: string, params?: unknown[]) => Promise<Row[]>;
export function readBase(query: Query, base: string, opts?: { days?: number; open?: boolean; prefix?: string; establishment?: string | null }): Promise<Turno[]>;
export function runOnce(deps: {
  query: Query;
  post: (body: Record<string, unknown>) => Promise<{ ok: boolean; status: number; erro?: string }>;
  config: { bases: { loja: string; tempoReal?: string; marca?: string }[]; diasParaConferir?: number };
  state: { hashes?: Record<string, string>; catalogHash?: string };
  log?: (m: string) => void;
}): Promise<{ read: number; changed: number; sent: number }>;
