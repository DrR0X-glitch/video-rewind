export const FORMAT_OPTIONS = ["dvd", "blu-ray", "4k-uhd", "vhs"] as const;

export function formatZoneLabel(
  zone: string,
  zones?: ReadonlyArray<{ code: string; label: string }>,
) {
  const configuredLabel = zones?.find((option) => option.code === zone)?.label;
  if (configuredLabel) {
    return configuredLabel;
  }

  switch (zone) {
    case "S":
    case "shed":
      return "Shed";
    case "D":
    case "display":
      return "Display";
    case "W":
    case "wall":
      return "Wall";
    default:
      return zone;
  }
}
