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

export interface ConsoleActivity {
  label: string
  percent: number
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

export function LogConsole({
  logs,
  active = false,
  activity,
}: {
  logs: LogEntry[]
  active?: boolean
  activity?: ConsoleActivity | null
}) {
  const logsRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const logsElement = logsRef.current
    if (!logsElement) return
    logsElement.scrollTop = logsElement.scrollHeight
  }, [activity, logs])

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <AnimateIcon animate={active} animateOnHover={!active} loop={active} asChild>
        <div className="group flex items-center gap-2 border-b border-border px-4 py-3">
          <Terminal
            size={16}
            className={cn(
              'transition-colors group-hover:text-emerald-500',
              active ? 'text-emerald-500' : 'text-muted-foreground',
            )}
          />
          <span className="text-sm font-medium text-foreground">Console</span>
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {logs.length} {logs.length === 1 ? 'line' : 'lines'}
          </span>
        </div>
      </AnimateIcon>

      <div
        id="logs"
        ref={logsRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 font-mono text-xs leading-relaxed"
      >
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
            {activity && (
              <div className="flex items-center gap-3" role="status" aria-live="polite">
                <span className="shrink-0 text-muted-foreground/50 tabular-nums">
                  --:--:--
                </span>
                <span className="shrink-0 font-semibold text-sky-400">WAIT</span>
                <span className="flex min-w-0 items-center gap-1 text-foreground/90">
                  <span className="break-words">
                    {activity.label} · {activity.percent}%
                  </span>
                  <span className="inline-flex items-end gap-0.5" aria-hidden="true">
                    {[0, 1, 2].map((index) => (
                      <span
                        key={index}
                        className="inline-block h-1 w-1 animate-bounce rounded-full bg-sky-400 motion-reduce:animate-pulse"
                        style={{ animationDelay: `${index * 140}ms` }}
                      />
                    ))}
                  </span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
