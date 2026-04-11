export const ZONE_OPTIONS = ["S", "D", "W"] as const;
export const FORMAT_OPTIONS = ["dvd", "blu-ray", "4k-uhd"] as const;

export type ZoneOption = (typeof ZONE_OPTIONS)[number];

export function formatZoneLabel(zone: string) {
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
