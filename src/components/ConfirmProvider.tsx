import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ConfirmContext } from '@/hooks/useConfirm'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog'
import { Button } from './ui/button'
import { Trash2 } from 'lucide-react'

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('')
  const resolve = useRef<((value: boolean) => void) | null>(null)
  const confirm = useCallback(
    (text: string) =>
      new Promise<boolean>((done) => {
        resolve.current?.(false)
        resolve.current = done
        setMessage(text)
      }),
    [],
  )
  const finish = (value: boolean) => {
    resolve.current?.(value)
    resolve.current = null
    setMessage('')
  }
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={!!message}
        onOpenChange={(open) => {
          if (!open) finish(false)
        }}
      >
        <DialogContent>
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <Trash2 className="h-5 w-5" />
          </div>
          <DialogTitle>Confirm this change</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
          <DialogFooter>
            <Button autoFocus variant="outline" onClick={() => finish(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => finish(true)}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}
