"use client";

export type StoreOption = { id: string; name: string };

/**
 * Escolha da marca (restaurante) do pedido, quando a unidade tem duas ou mais no mesmo caixa.
 * Botões grandes para o toque; por baixo são rádios, então o navegador não deixa enviar sem escolher.
 * Com uma marca só (ou nenhuma), não aparece.
 */
export function StorePicker({
  stores,
  value,
  onChange,
  defaultValue,
  required = true,
  idPrefix = "store",
  className = "",
}: {
  stores: StoreOption[];
  value?: string;
  onChange?: (id: string) => void;
  defaultValue?: string | null;
  required?: boolean;
  idPrefix?: string;
  className?: string;
}) {
  if (stores.length < 2) return null;
  return (
    <fieldset className={className}>
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Marca do pedido</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stores.map((s) => (
          <label
            key={s.id}
            htmlFor={`${idPrefix}-${s.id}`}
            className="flex min-h-12 cursor-pointer items-center rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition-colors hover:border-green-700 hover:bg-green-50 has-[:checked]:border-green-700 has-[:checked]:bg-green-700 has-[:checked]:text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-green-600 has-[:focus-visible]:ring-offset-1"
          >
            <input
              id={`${idPrefix}-${s.id}`}
              type="radio"
              name="storeId"
              value={s.id}
              required={required}
              className="sr-only"
              {...(onChange
                ? { checked: value === s.id, onChange: () => onChange(s.id) }
                : { defaultChecked: defaultValue === s.id })}
            />
            {s.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
