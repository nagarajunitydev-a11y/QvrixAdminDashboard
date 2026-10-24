import * as React from "react"
import { CheckCircle2, Info, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"

const alertVariants = cva(
  "relative flex w-full items-start gap-3 rounded-lg border p-4 text-body-md",
  {
    variants: {
      variant: {
        default: "bg-card text-foreground",
        destructive: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
        success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        warning: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-400",
        info: "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const icons = {
  default: Info,
  destructive: TriangleAlert,
  success: CheckCircle2,
  warning: TriangleAlert,
  info: Info,
}

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, children, ...props }, ref) => {
  const Icon = icons[variant ?? 'default']
  return (
    <div
      ref={ref}
      className={cn(alertVariants({ variant }), className)}
      role={variant === 'destructive' ? 'alert' : 'status'}
      {...props}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
})
Alert.displayName = "Alert"

const AlertDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-body-sm", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertDescription }
