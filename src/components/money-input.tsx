"use client";

import { useState } from "react";

/** Campo de dinheiro em reais. Aceita 1234,56 ou 1.234,56. O servidor é quem converte e valida. */
export function MoneyInput({
  name,
  defaultValue,
  required,
  placeholder = "0,00",
  className = "input-money",
  onValueChange,
  id,
  autoFocus,
  ariaLabel,
  value: controlled,
  readOnly,
}: {
  name: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  onValueChange?: (value: string) => void;
  id?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
  /** se informado, o campo é controlado por quem chama */
  value?: string;
  /** valor vem de outro lugar (ex.: soma da contagem de cédulas); continua sendo enviado no formulário */
  readOnly?: boolean;
}) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const value = controlled ?? inner;
  return (
    <input
      id={id ?? name}
      name={name}
      inputMode="decimal"
      autoComplete="off"
      required={required}
      placeholder={placeholder}
      className={className}
      value={value}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      readOnly={readOnly}
      pattern="[0-9.,\s]*"
      title="Digite o valor em reais, por exemplo 1.234,56"
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d.,]/g, "");
        setInner(v);
        onValueChange?.(v);
      }}
    />
  );
}
