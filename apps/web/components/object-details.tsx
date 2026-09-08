"use client";

export function ObjectDetails({ id }: { readonly id: string }) {
  return (
    <details className="object-details">
      <summary>Details</summary>
      <label>
        Object ID
        <input
          readOnly
          value={id}
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
    </details>
  );
}
