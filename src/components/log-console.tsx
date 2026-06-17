'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { AnimateIcon } from '@/components/animate-ui/icons/icon'
import { Terminal } from '@/components/animate-ui/icons/terminal'

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'step'

export interface LogEntry {
  id: number
  time: string
  level: LogLevel
  message: string
}

const levelStyles: Record<LogLevel, string> = {
  info: 'text-muted-foreground',
  success: 'text-emerald-500',
  warn: 'text-amber-500',
  error: 'text-destructive',
  step: 'text-foreground',
}

const levelLabel: Record<LogLevel, string> = {
  info: 'INFO',
  success: ' OK ',
  warn: 'WARN',
  error: 'ERR ',
  step: 'STEP',
}

export function LogConsole({ logs }: { logs: LogEntry[] }) {
  const endRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <AnimateIcon animateOnHover asChild>
        <div className="group flex items-center gap-2 border-b border-border px-4 py-3">
          <Terminal
            size={16}
            className="text-muted-foreground transition-colors group-hover:text-emerald-500"
          />
          <span className="text-sm font-medium text-foreground">Console</span>
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {logs.length} {logs.length === 1 ? 'line' : 'lines'}
          </span>
        </div>
      </AnimateIcon>

      <div id="logs" className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed">
        {logs.length === 0 ? (
          <p className="text-muted-foreground/60">
            {'>'} Waiting for input. Drop your files and press Sign.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {logs.map((log) => (
              <div key={log.id} className="flex gap-3">
                <span className="shrink-0 text-muted-foreground/50 tabular-nums">
                  {log.time}
                </span>
                <span
                  className={cn(
                    'shrink-0 font-semibold tracking-tight',
                    levelStyles[log.level],
                  )}
                >
                  {levelLabel[log.level]}
                </span>
                <span className="break-words text-foreground/90">
                  {log.message}
                </span>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>
    </div>
  )
}
