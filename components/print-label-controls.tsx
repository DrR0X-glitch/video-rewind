"use client";

import { useEffect } from "react";

export function PrintLabelControls({ autoPrint = false }: { autoPrint?: boolean }) {
  useEffect(() => {
    if (autoPrint) {
      window.print();
    }
  }, [autoPrint]);

  return (
    <button type="button" onClick={() => window.print()}>
      Print Label
    </button>
  );
}
