import { createContext, useContext } from 'react'

export const ConfirmContext = createContext<
  (message: string) => Promise<boolean>
>(async () => false)
export function useConfirm() {
  return useContext(ConfirmContext)
}
