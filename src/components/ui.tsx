import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  FileText,
  GitBranch,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../app-context";
import type { Artifact } from "../domain/types";

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="currentColor" />
      <path
        d="M11.5 12.5h11v8h-11zM18.5 20.5h10v7h-10z"
        fill="none"
        stroke="white"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle cx="28" cy="11.5" r="3" fill="#b8caff" />
    </svg>
  );
}
export function Button({
  variant = "secondary",
  size = "normal",
  className = "",
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "normal" | "small" | "icon";
}) {
  return (
    <button
      type={type}
      className={`button button-${variant} button-${size} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: string;
  dot?: boolean;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot ? <span className="status-dot" /> : null}
      {children}
    </span>
  );
}
export function Avatar({
  name = "Ricardo López",
  size = "normal",
}: {
  name?: string;
  size?: "small" | "normal" | "large";
}) {
  const initials = name
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
  return (
    <span
      className={`avatar avatar-${size} ${name === "Emma Wilson" ? "avatar-rose" : name === "Noah Kim" ? "avatar-teal" : ""}`}
      title={name}
    >
      {initials}
    </span>
  );
}
export function ProviderIcon({
  provider,
  size = 32,
}: {
  provider: string;
  size?: number;
}) {
  return (
    <span
      className={`provider-icon provider-${provider.toLowerCase()}`}
      style={{ width: size, height: size }}
      title={provider}
    >
      {provider === "Codex" ? (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m9 6-6 6 6 6m6-12 6 6-6 6m-2-14-2 16"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : provider === "Claude" ? (
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <path
              key={i}
              d="M12 3v6"
              transform={`rotate(${i * 36} 12 12)`}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          ))}
        </svg>
      ) : (
        <Sparkles size={18} />
      )}
    </span>
  );
}
export function ArtifactIcon({
  artifact,
  size = 17,
}: {
  artifact: Pick<Artifact, "kind" | "category">;
  size?: number;
}) {
  return (
    <span
      className={`artifact-icon artifact-${artifact.kind} ${artifact.category === "Epic" ? "artifact-epic" : ""}`}
    >
      {artifact.kind === "page" ? (
        <FileText size={size} />
      ) : artifact.category === "Epic" ? (
        <Sparkles size={size} />
      ) : (
        <Check size={size} />
      )}
    </span>
  );
}
export function SourceChip({
  id,
  checkpointId,
  compact = false,
}: {
  id: string;
  checkpointId?: string;
  compact?: boolean;
}) {
  const { state, open } = useApp();
  const a = checkpointId
    ? state.checkpoints.find((c) => c.id === checkpointId)?.artifacts[id]
    : state.artifacts[id];
  if (!a) return null;
  const restricted = state.flags.accessLost && id === "policy";
  return (
    <button
      className={`source-chip ${compact ? "compact" : ""}`}
      onClick={() => open({ type: "evidence", artifactId: id, checkpointId })}
    >
      <ArtifactIcon artifact={a} size={13} />
      <span>{restricted ? "Unavailable source" : a.key}</span>
      {!compact ? <ChevronRight size={12} /> : null}
    </button>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? (
          <div className="page-description">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
  icon = "checkpoint",
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: "checkpoint" | "branch" | "check";
}) {
  return (
    <div className="empty-state">
      <div className="empty-illustration">
        <span className="empty-orbit" />
        <span className="empty-orbit inner" />
        <span className="empty-icon">
          {icon === "branch" ? (
            <GitBranch size={27} />
          ) : icon === "check" ? (
            <CheckCircle2 size={29} />
          ) : (
            <BrandMark size={35} />
          )}
        </span>
        <i />
        <i />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Loading({
  label = "Preparing your workspace…",
}: {
  label?: string;
}) {
  return (
    <div className="loading-state" role="status">
      <Loader2 size={25} className="spin" />
      <span>{label}</span>
    </div>
  );
}
export function Notice({
  children,
  tone = "info",
  action,
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "success" | "error";
  action?: ReactNode;
}) {
  return (
    <div className={`notice notice-${tone}`}>
      <CircleDot size={16} />
      <div>{children}</div>
      {action}
    </div>
  );
}
export function TextField({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: { id: string; label: string; count?: number }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <button
          key={i.id}
          role="tab"
          aria-selected={value === i.id}
          className={value === i.id ? "active" : ""}
          onClick={() => onChange(i.id)}
        >
          {i.label}
          {i.count !== undefined ? <span>{i.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
export function Dialog({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  drawer = false,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  drawer?: boolean;
  footer?: ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closer = useRef(onClose);
  closer.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panel.current?.querySelector<HTMLElement>(
      'button,input,textarea,select,[tabindex="0"]',
    );
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closer.current();
      }
      if (e.key === "Tab") {
        const els = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]',
          ) || [],
        ).filter((el) => el.getClientRects().length > 0);
        const first = els[0],
          last = els.at(-1);
        if (!first) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className={`overlay ${drawer ? "overlay-drawer" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={`dialog ${wide ? "dialog-wide" : ""} ${drawer ? "drawer" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
      >
        <div className="dialog-head">
          <div>
            <h2 id={id}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={19} />
          </Button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
export function Stepper({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}) {
  return (
    <div className="stepper">
      {steps.map((step, i) => (
        <div
          key={step}
          className={`step ${i === current ? "active" : i < current ? "complete" : ""}`}
        >
          <span>{i < current ? <Check size={12} /> : i + 1}</span>
          <small>{step}</small>
          {i < steps.length - 1 ? <i /> : null}
        </div>
      ))}
    </div>
  );
}
export function RichText({ text }: { text: string }) {
  return (
    <div className="rich-text">
      {text.split("\n").map((line, i) =>
        line.startsWith("## ") ? (
          <h3 key={i}>{line.slice(3)}</h3>
        ) : line.startsWith("• ") ? (
          <div className="rich-bullet" key={i}>
            <span /> {line.slice(2)}
          </div>
        ) : line ? (
          <p key={i}>{line}</p>
        ) : (
          <div className="paragraph-gap" key={i} />
        ),
      )}
    </div>
  );
}
export function ArrowLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowRight size={14} />
    </button>
  );
}
