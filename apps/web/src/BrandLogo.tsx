type BrandLogoProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
  decorative?: boolean;
};

const SRC = "/brand/logo.png";

/** Hold'em House monogram — served from public/brand. */
export function BrandLogo({
  size = "md",
  className = "",
  decorative = true,
}: BrandLogoProps) {
  return (
    <img
      src={SRC}
      alt={decorative ? "" : "Hold'em House"}
      className={`brand-logo brand-logo-${size}${className ? ` ${className}` : ""}`}
      width={size === "lg" ? 96 : size === "md" ? 40 : 28}
      height={size === "lg" ? 96 : size === "md" ? 40 : 28}
      decoding="async"
      draggable={false}
    />
  );
}
