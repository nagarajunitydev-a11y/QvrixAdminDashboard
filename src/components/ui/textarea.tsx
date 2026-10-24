import * as React from "react"

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={[
          "flex min-h-[90px] w-full rounded-md border border-input bg-card px-3 py-2 text-body-md text-foreground",
          "placeholder:text-muted-foreground/70 focus-visible:outline-none",
          "focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15",
          "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
          className ?? "",
        ].join(" ")}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
