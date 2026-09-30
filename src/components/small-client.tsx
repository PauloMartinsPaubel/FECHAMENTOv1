"use client";

export function PrintButton({ label = "Imprimir / salvar em PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn-secondary no-print" onClick={() => window.print()}>
      {label}
    </button>
  );
}

/** Botão que pede confirmação antes de enviar o formulário. */
export function ConfirmSubmit({
  children,
  message,
  className,
  name,
  value,
  disabled,
  title,
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={className}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
