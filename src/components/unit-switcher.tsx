"use client";

import { switchUnitAction } from "@/app/actions/units";

export function UnitSwitcher({ units, current }: { units: { restaurantId: string; name: string }[]; current: string }) {
  return (
    <form action={switchUnitAction}>
      <label className="sr-only" htmlFor="unit-switch">Unidade</label>
      <select
        id="unit-switch"
        name="restaurantId"
        defaultValue={current}
        className="input py-1 text-sm"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {units.map((u) => <option key={u.restaurantId} value={u.restaurantId}>{u.name}</option>)}
      </select>
    </form>
  );
}
