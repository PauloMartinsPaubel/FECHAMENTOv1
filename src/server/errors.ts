/** Erro com mensagem própria para mostrar ao usuário (já em português). */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "VALIDATION"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "CONFLICT"
      | "STATE"
      | "DUPLICATE_SUSPECT"
      | "INTEGRITY" = "VALIDATION",
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ServiceError) return err.message;
  console.error(err);
  return "Não foi possível concluir a operação. Tente novamente; se persistir, avise o administrador.";
}
