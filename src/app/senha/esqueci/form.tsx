"use client";

import { ActionForm } from "@/components/action-form";
import { requestResetAction } from "@/app/actions/password-reset";

export function RequestResetForm() {
  return (
    <ActionForm action={requestResetAction} className="space-y-4">
      {(state) =>
        state?.ok ? null : (
          <>
            <div>
              <label className="label" htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" autoComplete="username" required autoFocus className="input" />
            </div>
            <button type="submit" className="btn-primary w-full">Enviar link</button>
          </>
        )
      }
    </ActionForm>
  );
}
