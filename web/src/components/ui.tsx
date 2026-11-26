"use client";

import { LoaderCircle, type LucideIcon } from "lucide-react";
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { initials } from "@/lib/format/names";
import { useT } from "@/i18n/provider";

const cx = (...classes: (string | false | null | undefined)[]): string => classes.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "plain" | "destructive" | "destructivePlain";

const variants: Record<Variant, string> = {
  primary: "bg-accent-fill text-on-accent hover:brightness-110 active:brightness-95",
  secondary: "bg-accent-soft text-accent hover:brightness-105",
  plain: "text-accent hover:bg-fill",
  destructive: "bg-danger-soft text-danger hover:brightness-105",
  destructivePlain: "text-danger hover:bg-danger-soft",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "regular" | "large" | "small";
  loading?: boolean;
  icon?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "regular", loading = false, icon: Icon, className, children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "large" && "min-h-[50px] w-full px-6 text-[17px]",
        size === "regular" && "min-h-[44px] px-5 text-[17px]",
        size === "small" && "min-h-[36px] px-4 text-[15px]",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" size={18} /> : Icon !== undefined ? <Icon aria-hidden="true" size={18} /> : null}
      {children}
    </button>
  );
});

export function IconButton({ label, icon: Icon, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx("inline-flex h-11 w-11 items-center justify-center rounded-full text-accent transition hover:bg-fill disabled:opacity-50", className)}
      {...rest}
    >
      <Icon aria-hidden="true" size={22} />
    </button>
  );
}

/** Lista agrupada do iOS (inset grouped): cabeçalho, linhas com separador e rodapé. */
export function Section({ title, footer, children, className }: { title?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mb-7", className)}>
      {title !== undefined && <h2 className="mb-1.5 px-4 text-[13px] font-normal uppercase tracking-wide text-secondary">{title}</h2>}
      <div className="overflow-hidden rounded-[var(--radius-control)] bg-card [&>*+*]:border-t [&>*+*]:border-separator">{children}</div>
      {footer !== undefined && <p className="mt-1.5 px-4 text-[13px] text-secondary">{footer}</p>}
    </section>
  );
}

export function Row({
  children, onClick, href, leading, trailing, chevron = false, destructive = false, className, disabled,
}: {
  children: ReactNode; onClick?: () => void; href?: string; leading?: ReactNode; trailing?: ReactNode; chevron?: boolean;
  destructive?: boolean; className?: string; disabled?: boolean;
}) {
  const body = (
    <>
      {leading !== undefined && <span className="shrink-0">{leading}</span>}
      <span className={cx("min-w-0 flex-1 text-left", destructive && "text-danger")}>{children}</span>
      {trailing !== undefined && <span className="shrink-0 text-secondary">{trailing}</span>}
      {chevron && <span aria-hidden="true" className="shrink-0 text-muted">›</span>}
    </>
  );
  const classes = cx("flex min-h-[48px] w-full items-center gap-3 px-4 py-2.5", (onClick !== undefined || href !== undefined) && "transition hover:bg-fill", className);
  if (href !== undefined) return <a className={classes} href={href}>{body}</a>;
  if (onClick !== undefined) return <button type="button" disabled={disabled} className={cx(classes, "disabled:opacity-50")} onClick={onClick}>{body}</button>;
  return <div className={classes}>{body}</div>;
}

export function Toggle({ label, description, checked, onChange, disabled }: {
  label: ReactNode; description?: ReactNode; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-h-[48px] items-center gap-3 px-4 py-2.5">
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {description !== undefined && <span className="block text-[13px] text-secondary">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative h-[31px] w-[51px] shrink-0 rounded-full transition disabled:opacity-50", checked ? "bg-[var(--room-green)]" : "bg-fill-strong")}
      >
        <span className={cx("absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-[2px]")} />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-[9px] bg-fill p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cx(
            "min-h-[32px] flex-1 rounded-[7px] px-3 text-[13px] font-semibold transition",
            option.value === value ? "bg-elevated text-label shadow-sm" : "text-label/80",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null; hideLabel?: boolean }>(
  function TextField({ label, hint, error, hideLabel = false, className, id, ...rest }, ref) {
    const generated = useId();
    const inputID = id ?? generated;
    const hintID = `${inputID}-hint`;
    return (
      <div className={cx("mb-3", className)}>
        <label htmlFor={inputID} className={cx("mb-1 block px-1 text-[15px] text-secondary", hideLabel && "sr-only")}>{label}</label>
        <input
          ref={ref}
          id={inputID}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint !== undefined || error ? hintID : undefined}
          className="min-h-[50px] w-full rounded-[var(--radius-control)] border border-transparent bg-card px-4 text-[17px] text-label outline-none placeholder:text-muted focus:border-accent"
          {...rest}
        />
        {(error || hint !== undefined) && (
          <p id={hintID} className={cx("mt-1 px-1 text-[13px]", error ? "text-danger" : "text-secondary")}>{error || hint}</p>
        )}
      </div>
    );
  },
);

export function Spinner({ label }: { label?: string }) {
  const t = useT();
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-3 py-16 text-secondary">
      <LoaderCircle aria-hidden="true" className="animate-spin" size={28} />
      <span className="text-[15px]">{label ?? t("Carregando…")}</span>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, message, action }: { icon?: LucideIcon; title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {Icon !== undefined && <Icon aria-hidden="true" size={44} className="mb-3 text-muted" strokeWidth={1.5} />}
      <p className="font-rounded text-[20px] font-semibold">{title}</p>
      {message !== undefined && <p className="mt-1.5 max-w-sm text-[15px] text-secondary">{message}</p>}
      {action !== undefined && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-14 text-center">
      <p className="font-rounded text-[20px] font-semibold">{t("Não foi possível carregar")}</p>
      <p className="mt-1.5 max-w-sm text-[15px] text-secondary">{message}</p>
      {onRetry !== undefined && <Button className="mt-5" variant="secondary" onClick={onRetry}>{t("Tentar novamente")}</Button>}
    </div>
  );
}

const AVATAR_SIZES = { regular: 36, row: 40, toolbar: 44, profile: 56, hero: 96 } as const;

/** Foto ou até duas iniciais no tom do acento (ResidentAvatar do app). */
export function Avatar({ name, photoURL, size = "regular", label }: { name: string; photoURL?: string | null; size?: keyof typeof AVATAR_SIZES; label?: string }) {
  const side = AVATAR_SIZES[size];
  const accessible = label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  if (photoURL) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photoURL} alt={label ?? ""} width={side} height={side} className="shrink-0 rounded-full object-cover" style={{ width: side, height: side }} />
    );
  }
  return (
    <span
      {...accessible}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-rounded font-semibold text-accent"
      style={{ width: side, height: side, fontSize: Math.round(side * 0.4) }}
    >
      {initials(name)}
    </span>
  );
}

/** Anel de progresso do ciclo (cards da Casa). */
export function ProgressRing({ fraction, color, size = 28 }: { fraction: number; color: string; size?: number }) {
  const stroke = 3.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--fill-strong)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${circumference * Math.min(1, Math.max(0, fraction))} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string | undefined; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex items-end justify-between gap-3 pt-2">
      <div className="min-w-0">
        <h1 className="font-rounded text-[34px] font-bold leading-tight tracking-tight">{title}</h1>
        {subtitle !== undefined && <p className="truncate text-[15px] text-secondary">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}
