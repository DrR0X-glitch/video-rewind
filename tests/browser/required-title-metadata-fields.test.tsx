import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RequiredTitleMetadataFields } from "@/components/required-title-metadata-fields";

describe("required title metadata fields", () => {
  afterEach(() => cleanup());

  it("requires title, sort title, and a four digit release year", () => {
    render(
      <form>
        <RequiredTitleMetadataFields
          titleName="title"
          sortTitleName="sort_title"
          releaseYearName="release_year"
        />
      </form>,
    );
    for (const name of ["title", "sort_title", "release_year"]) {
      const input = document.querySelector(`[name=${name}]`) as HTMLInputElement;
      expect(input.required).toBe(true);
    }
    expect(screen.getByLabelText("Release year").getAttribute("min")).toBe("1000");
    expect(screen.getByLabelText("Release year").getAttribute("max")).toBe("9999");
  });
});
