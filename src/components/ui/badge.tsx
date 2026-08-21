import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-label-sm font-semibold ring-1 ring-inset",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-primary ring-primary/20",
        secondary: "bg-muted text-secondary-foreground ring-border",
        destructive: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400",
        success: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
        warning: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
        info: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-400",
        outline: "text-foreground ring-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean
}

function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {dot && (
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            variant === "success" && "bg-emerald-500",
            variant === "warning" && "bg-amber-500",
            variant === "destructive" && "bg-red-500",
            variant === "info" && "bg-blue-500",
            variant === "default" && "bg-primary",
            variant === "secondary" && "bg-slate-400",
            variant === "outline" && "bg-slate-400"
          )}
        />
      )}
      {children}
    </span>
  )
}

export { Badge, badgeVariants }
