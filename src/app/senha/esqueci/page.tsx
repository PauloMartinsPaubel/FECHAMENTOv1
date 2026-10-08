import type { Metadata } from "next";
import { RequestResetForm } from "./form";

export const metadata: Metadata = { title: "Esqueci minha senha" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h2 className="mb-1 text-lg font-bold">Esqueci minha senha</h2>
      <p className="mb-4 text-sm text-stone-600">Informe o e-mail que você usa para entrar. Vamos mandar um link para criar uma senha nova.</p>
      <RequestResetForm />
    </>
  );
}
