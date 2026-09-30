export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  /** DUPLICATE_SUSPECT permite ao formulário oferecer "lançar mesmo assim" */
  code?: string;
} | null;
