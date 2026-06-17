'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { AnimateIcon } from '@/components/animate-ui/icons/icon'
import { Trash2 } from '@/components/animate-ui/icons/trash-2'

type AnimatedIcon = React.ComponentType<{ size?: number; className?: string }>

interface FileDropProps {
  id: string
  label: string
  hint: string
  accept: string
  multiple?: boolean
  icon: AnimatedIcon
  /** full tailwind class applied to the icon wrapper on hover, e.g. "group-hover:text-blue-500" */
  hoverColor: string
  files: File[]
  onFiles: (files: File[]) => void
}

export function FileDrop({
  id,
  label,
  hint,
  accept,
  multiple = false,
  icon: Icon,
  hoverColor,
  files,
  onFiles,
}: FileDropProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)
  const [hovered, setHovered] = React.useState(false)
  const hasFiles = files.length > 0

  const setNextFiles = (nextFiles: FileList | null) => {
    if (!nextFiles?.length) return
    const selected = Array.from(nextFiles)
    onFiles(multiple ? selected : selected.slice(0, 1))
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label
          htmlFor={id}
          className="text-sm font-medium text-foreground"
        >
          {label}
        </label>
        {hasFiles && (
          <AnimateIcon animateOnHover asChild>
            <button
              type="button"
              onClick={() => {
                onFiles([])
                if (inputRef.current) inputRef.current.value = ''
              }}
              aria-label={`Remove ${label}`}
              title={`Remove ${label}`}
              className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 size={16} />
            </button>
          </AnimateIcon>
        )}
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          setNextFiles(e.dataTransfer.files)
        }}
        className={cn(
          'group flex w-full items-center gap-3 rounded-xl border border-dashed border-border bg-card px-4 py-3.5 text-left transition-all hover:border-foreground/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          dragging && 'border-foreground/60 bg-muted/60',
          hasFiles && 'border-solid border-foreground/30',
        )}
      >
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors',
            hoverColor,
          )}
        >
          <AnimateIcon animate={hovered}>
            <Icon size={20} />
          </AnimateIcon>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {hasFiles ? files.map((file) => file.name).join(', ') : hint}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {hasFiles
              ? files.map((file) => `${(file.size / 1024).toFixed(1)} KB`).join(' + ')
              : `${multiple ? 'Accepts multiple' : 'Accepts'} ${accept}`}
          </span>
        </span>
      </button>

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => setNextFiles(e.target.files)}
      />
    </div>
  )
}
