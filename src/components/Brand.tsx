import { Radar } from 'lucide-react'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="brand-mark">
        <Radar className="h-6 w-6" aria-hidden="true" />
      </div>
      {!compact && (
        <div className="min-w-0">
          <p className="whitespace-nowrap font-headline text-[17px] font-semibold tracking-tight">
            Crewtraxa <span className="font-normal opacity-60">Console</span>
          </p>
          <p className="mt-0.5 whitespace-nowrap text-[10px] tracking-wide opacity-60">
            Every Team. Every Site. In Sync.
          </p>
        </div>
      )}
    </div>
  )
}
