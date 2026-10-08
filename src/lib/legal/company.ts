/**
 * Dados de quem presta o serviço, usados nos Termos de Uso e na Política de Privacidade.
 * PREENCHER antes de vender: enquanto houver "[preencher]", as páginas mostram um aviso.
 */
export const COMPANY = {
  name: "[preencher: razão social]",
  document: "[preencher: CNPJ]",
  address: "[preencher: endereço completo]",
  email: "fechamentodecaixaonline@gmail.com",
  dpoEmail: "[preencher: e-mail do encarregado de dados]",
  forum: "[preencher: cidade/UF do foro]",
};

/** Muda quando o texto muda; o aceite fica registrado com a versão. */
export const TERMS_VERSION = "2026-10-08";

/** Canal de atendimento mostrado no rodapé e nas telas de erro. Preencha com o WhatsApp de suporte (só números, com DDI e DDD). */
export const SUPPORT = {
  email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "",
  whatsapp: (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || "").replace(/\D/g, ""),
};

export const companyIncomplete = Object.values(COMPANY).some((v) => v.includes("[preencher"));
