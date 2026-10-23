import { useState } from 'react'

export function useSidebarState() {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('trackora-sidebar-collapsed') === 'true',
  )
  return {
    open,
    collapsed,
    toggle: () => setOpen((v) => !v),
    close: () => setOpen(false),
    collapse: () =>
      setCollapsed((v) => {
        localStorage.setItem('trackora-sidebar-collapsed', String(!v))
        return !v
      }),
  }
}
