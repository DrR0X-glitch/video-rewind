type PosterSwatchProps = {
  title: string;
  year: string;
  color: string;
  size?: "card" | "detail";
};

export function PosterSwatch({
  title,
  year,
  color,
  size = "card",
}: PosterSwatchProps) {
  return (
    <div
      className={`poster-swatch poster-${size}`}
      style={{ backgroundColor: color }}
      aria-label={`${title} poster placeholder`}
    >
      <span className="poster-year">{year}</span>
      <strong>{title}</strong>
    </div>
  );
}
