import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeToggle } from "@/components/theme-toggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    cleanup();
  });

  it("restores a saved theme when the control mounts", () => {
    window.localStorage.setItem("dvd-store-theme", "dark");

    render(<ThemeToggle />);

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("toggles and persists the selected theme", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle Theme" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("dvd-store-theme")).toBe("dark");
  });
});
