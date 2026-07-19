type PosterSwatchProps = {
  title: string;
  color: string;
  size?: "card" | "detail";
};

export function PosterSwatch({
  title,
  color,
  size = "card",
}: PosterSwatchProps) {
  return (
    <div
      className={`poster-swatch poster-${size}`}
      style={{ backgroundColor: color }}
      aria-label={`${title} poster placeholder`}
    >
      <strong>{title}</strong>
    </div>
  );
}
