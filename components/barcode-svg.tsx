import { getCode128Metrics, validateInventoryCode } from "@/lib/barcode";

type BarcodeSvgProps = {
  value: string;
  moduleWidth?: number;
  barHeight?: number;
  showText?: boolean;
};

export function BarcodeSvg({
  value,
  moduleWidth = 2,
  barHeight = 72,
  showText = true,
}: BarcodeSvgProps) {
  if (!validateInventoryCode(value)) {
    return null;
  }

  const { modules, width, height } = getCode128Metrics(value, moduleWidth, barHeight);
  const textHeight = showText ? 22 : 0;
  const offsets = modules.reduce<number[]>((acc, module, index) => {
    if (index === 0) {
      acc.push(0);
      return acc;
    }

    acc.push(acc[index - 1] + modules[index - 1] * moduleWidth);
    return acc;
  }, []);

  const rects = modules.flatMap((module, index) =>
    index % 2 === 0
      ? [
          <rect
            key={`${index}-${offsets[index]}`}
            x={offsets[index]}
            y={0}
            width={module * moduleWidth}
            height={height}
            fill="black"
          />,
        ]
      : [],
  );

  return (
    <svg
      className="barcode-svg"
      viewBox={`0 0 ${width} ${height + textHeight}`}
      role="img"
      aria-label={`Barcode ${value}`}
    >
      <rect width={width} height={height + textHeight} fill="white" />
      {rects}
      {showText ? (
        <text
          x={width / 2}
          y={height + 16}
          textAnchor="middle"
          fontSize="14"
          fontFamily="monospace"
          fill="black"
        >
          {value}
        </text>
      ) : null}
    </svg>
  );
}
