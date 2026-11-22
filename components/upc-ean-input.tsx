"use client";

import { useState } from "react";

import { UpcEanScanner } from "@/components/upc-ean-scanner";

export function UpcEanInput({ defaultValue = "" }: { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);

  return (
    <>
      <label>
        UPC/EAN barcode (optional)
        <input
          type="text"
          name="upcEan"
          inputMode="numeric"
          autoComplete="off"
          maxLength={20}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <UpcEanScanner onDetected={setValue} />
    </>
  );
}
