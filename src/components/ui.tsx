"use client";

import { useEffect, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { AlertCircle, Check, ChevronRight, Inbox, X } from "lucide-react";
import { cn, STATUS_LABEL, type DiffLine } from "@/lib/utils";
import type { DiffLine as DiffLineType } from "@/lib/utils";

export function Button({
  children, variant = "secondary", size = "md", className, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md";
}) {
  const variants = {
    primary: "bg-brand-500 text-white hover:bg-brand-600 border border-brand-500",
    secondary: "bg-white text-ink-700 border border-ink-200 hover:bg-ink-50",
    ghost: "bg-transparent text-ink-500 hover:bg-ink-100 hover:text-ink-800 border border-transparent",
    danger: "bg-white text-semantic-danger border border-red-200 hover:bg-red-50",
    success: "bg-semantic-success text-white border border-semantic-success hover:brightness-95",
  };
  return (
    <button
      {...props}
      className={cn("btn-base", size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-9 px-3.5", variants[variant], className)}
    >
      {children}
    </button>
  );
}

const TONES: Record<string, string> = {
  neutral: "bg-ink-100 text-ink-600 border-ink-200",
  brand: "bg-brand-50 text-brand-600 border-brand-100",
  success: "bg-emerald-50 text-semantic-success border-emerald-100",
  warning: "bg-amber-50 text-semantic-warning border-amber-100",
  danger: "bg-red-50 text-semantic-danger border-red-100",
  purple: "bg-violet-50 text-violet-600 border-violet-100",
};

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: keyof typeof TONES | string; className?: string }) {
  return <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4", TONES[tone] ?? TONES.neutral, className)}>{children}</span>;
}

const STATUS_TONE: Record<string, string> = {
  draft: "neutral", discussing: "brand", executing: "brand", review: "warning", done: "success",
  blocked: "danger", cancelled: "neutral", archived: "neutral",
  queued: "neutral", running: "brand", waiting_input: "warning", waiting_approval: "warning",
  succeeded: "success", failed: "danger", cancelled_: "neutral", timed_out: "danger",
  online: "success", busy: "warning", offline: "neutral", error: "danger", untested: "neutral", disabled: "neutral",
  pending: "warning", approved: "success", rejected: "danger", expired: "neutral", revoked: "neutral",
  accepted: "success", changes: "danger",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  const color = tone === "success" ? "bg-emerald-500" : tone === "warning" ? "bg-amber-500" : tone === "danger" ? "bg-red-500" : tone === "brand" ? "bg-brand-500" : "bg-ink-400";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", TONES[tone])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} />
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Card({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("surface", className)}>{children}</div>;
}

export function Field({ label, hint, children, required }: { label: string; hint?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-[12px] font-medium text-ink-700">
        {label}{required && <span className="text-semantic-danger">*</span>}
        {hint && <span className="font-normal text-ink-400">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}

const inputClass = "w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-[13px] text-ink-800 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputClass, "resize-y leading-6", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputClass, "cursor-pointer appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b7688%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8", props.className)} />;
}

export function Modal({ open, onClose, title, children, footer, width = "max-w-[560px]" }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-ink-900/35 px-4 py-[8vh]" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={cn("w-full rounded-xl border border-ink-200 bg-white shadow-pop animate-fade-in", width)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700" aria-label="关闭"><X size={16} /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-ink-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, side = "right" }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; side?: "right" | "left";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-ink-900/25" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <aside
        className={cn("absolute top-0 h-full w-full max-w-[420px] overflow-y-auto border-ink-200 bg-white shadow-pop animate-slide-in", side === "right" ? "right-0 border-l" : "left-0 border-r")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-100 bg-white px-4 py-3">
          <h2 className="text-[14px] font-semibold text-ink-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-ink-400 hover:bg-ink-100" aria-label="关闭"><X size={16} /></button>
        </div>
        <div className="p-4">{children}</div>
      </aside>
    </div>
  );
}

export function EmptyState({ icon, title, description, action, compact }: {
  icon?: ReactNode; title: string; description?: string; action?: ReactNode; compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "py-8" : "py-16")}>
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-ink-200 bg-ink-50 text-ink-400">
        {icon ?? <Inbox size={20} />}
      </div>
      <p className="text-[14px] font-medium text-ink-700">{title}</p>
      {description && <p className="mt-1 max-w-[420px] text-[12px] leading-5 text-ink-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-ink-100", className)} />;
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[14px] font-semibold text-ink-800">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12px] text-ink-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Avatar({ name, color, size = 26 }: { name: string; color?: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white"
      style={{ width: size, height: size, background: color ?? "#6b7688" }}
      title={name}
    >
      {name.replace(/Agent|演示| /g, "").slice(0, 2) || "A"}
    </span>
  );
}

export function AgentChip({ name, color, onClick }: { name: string; color?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white py-0.5 pl-0.5 pr-2 text-[11px] text-ink-600 hover:border-brand-200 hover:bg-brand-50">
      <Avatar name={name} color={color} size={18} />
      {name}
    </button>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] text-red-800">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span className="flex-1">{message}。已有数据未受影响。</span>
      {onRetry && <button onClick={onRetry} className="font-medium underline underline-offset-2">重试</button>}
    </div>
  );
}

export function MarkdownView({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("prose-doc text-[13px] leading-6 text-ink-700", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: ({ children }) => <h1 className="mb-3 mt-1 text-[18px] font-semibold text-ink-900">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-5 text-[15px] font-semibold text-ink-800">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-4 text-[14px] font-semibold text-ink-800">{children}</h3>,
          p: ({ children }) => <p className="my-2">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline underline-offset-2">{children}</a>,
          code: ({ children }) => <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[12px]">{children}</code>,
          pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-lg bg-ink-900 p-3 text-[12px] text-ink-100">{children}</pre>,
          blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-brand-200 pl-3 text-ink-600">{children}</blockquote>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function DiffView({ lines }: { lines: DiffLineType[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-ink-200 bg-white font-mono text-[12px]">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "flex gap-3 border-b border-ink-50 px-3 py-0.5 last:border-0",
            line.kind === "add" && "bg-emerald-50 text-emerald-800",
            line.kind === "del" && "bg-red-50 text-red-700",
          )}
        >
          <span className="w-8 shrink-0 select-none text-right text-ink-400">{line.kind === "del" ? line.oldLine : line.newLine ?? ""}</span>
          <span className="w-3 shrink-0 select-none">{line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}</span>
          <span className="whitespace-pre-wrap break-all">{line.text || " "}</span>
        </div>
      ))}
    </div>
  );
}

export function Stepper({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
      {steps.map((step, i) => (
        <div key={step} className="flex items-center gap-1">
          <span className={cn(
            "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-medium",
            i < current ? "bg-brand-100 text-brand-700" : i === current ? "bg-brand-500 text-white" : "bg-ink-100 text-ink-400",
          )}>{i < current ? <Check size={11} /> : i + 1}</span>
          <span className={cn("whitespace-nowrap text-[11px]", i === current ? "font-medium text-ink-800" : "text-ink-400")}>{step}</span>
          {i < steps.length - 1 && <ChevronRight size={11} className="mx-0.5 text-ink-300" />}
        </div>
      ))}
    </div>
  );
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function KV({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-[12px]">
      <span className="shrink-0 text-ink-500">{label}</span>
      <span className="text-right text-ink-800">{value}</span>
    </div>
  );
}

export type { DiffLine };
