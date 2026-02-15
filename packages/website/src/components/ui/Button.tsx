import type { ReactNode } from "react";

type ButtonVariant = "primary" | "secondary";

type ButtonProps = {
  children: ReactNode;
  variant?: ButtonVariant;
  href?: string;
  onClick?: () => void;
  className?: string;
  external?: boolean;
  "aria-label"?: string;
};

export function Button({
  children,
  variant = "primary",
  href,
  onClick,
  className = "",
  external = false,
  "aria-label": ariaLabel,
}: ButtonProps) {
  const baseStyles =
    "inline-flex items-center justify-center font-semibold rounded-lg transition-[background,box-shadow,transform,color,border-color] duration-200 text-base px-6 py-3";

  const variantStyles = {
    primary: "btn-primary",
    secondary: "btn-secondary",
  };

  const classes = `${baseStyles} ${variantStyles[variant]} ${className}`;

  if (href) {
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        className={classes}
        aria-label={ariaLabel}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      onClick={onClick}
      className={classes}
      type="button"
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
