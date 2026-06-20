'use client'

import * as React from 'react'
import { DotLottie } from '@lottiefiles/dotlottie-web'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'

import { FileDrop } from '@/components/file-drop'
import { InstallQrDialog } from '@/components/install-qr-dialog'
import {
  LogConsole,
  type ConsoleActivity,
  type LogEntry,
  type LogLevel,
} from '@/components/log-console'
import { ThemeToggle } from '@/components/theme-toggle'

import { AnimateIcon } from '@/components/animate-ui/icons/icon'
import { Blocks } from '@/components/animate-ui/icons/blocks'
import { LockKeyhole } from '@/components/animate-ui/icons/lock-keyhole'
import { BadgeCheck } from '@/components/animate-ui/icons/badge-check'
import { Layers } from '@/components/animate-ui/icons/layers'
import { Key } from '@/components/animate-ui/icons/key'
import { Fingerprint } from '@/components/animate-ui/icons/fingerprint'
import { Trash2 } from '@/components/animate-ui/icons/trash-2'
import { Download } from '@/components/animate-ui/icons/download'
import { LoaderCircle } from '@/components/animate-ui/icons/loader-circle'
import { CircleCheckBig } from '@/components/animate-ui/icons/circle-check-big'
import { Send } from '@/components/animate-ui/icons/send'
import { Copy } from '@/components/animate-ui/icons/copy'
import { Lock } from '@/components/animate-ui/icons/lock'
import { ClipboardList } from '@/components/animate-ui/icons/clipboard-list'
import type { InstallMetadata } from '@/install-api'
import {
  clearIpaHistory,
  createLocalHistoryEntry,
  readIpaHistory,
  updateHistoryEntryUpload,
  upsertIpaHistoryEntry,
  type IpaHistoryEntry,
} from '@/history-api'
import { resolveProvisioningCompatibility } from '@/provisioning-profile'
import { saveOutput, signIpa } from '@/zsign-api'
import type { OutputFile, SignIpaOptions, ZsignProgress } from '@/types'

type SignState = 'idle' | 'signing' | 'done' | 'error'
type Route = 'app' | 'privacy' | 'legal'

type ProgressState = {
  value: number
  label: string
}

type CachedFileData = {
  name: string
  type: string
  lastModified: number
  data: ArrayBuffer
}

type CachedCertInfo = {
  p12?: CachedFileData
  profiles: CachedFileData[]
  password?: string
  savedAt: number
}

let logCounter = 0

const certCacheDbName = 'zsign-wasm-cert-cache'
const certCacheStore = 'cert-info'
const certCacheKey = 'default'

function routeFromHash(): Route {
  if (window.location.hash === '#privacy') return 'privacy'
  if (window.location.hash === '#legal') return 'legal'
  return 'app'
}

function useRoute() {
  const [route, setRoute] = React.useState<Route>(routeFromHash)

  React.useEffect(() => {
    const updateRoute = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', updateRoute)
    return () => window.removeEventListener('hashchange', updateRoute)
  }, [])

  return route
}

function GithubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      focusable="false"
    >
      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.04c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.21.09 1.85 1.25 1.85 1.25 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.4 11.4 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.62-5.47 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.82.58A12 12 0 0 0 12 .5Z" />
    </svg>
  )
}

function openCertCacheDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(certCacheDbName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(certCacheStore)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open cert cache.'))
  })
}

async function withCertCacheStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await openCertCacheDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(certCacheStore, mode)
      const request = callback(transaction.objectStore(certCacheStore))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Cert cache request failed.'))
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Cert cache transaction failed.'))
    })
  } finally {
    db.close()
  }
}

async function readCachedCertInfo() {
  return (await withCertCacheStore('readonly', (store) =>
    store.get(certCacheKey),
  )) as CachedCertInfo | null
}

async function writeCachedCertInfo(value: CachedCertInfo) {
  await withCertCacheStore('readwrite', (store) => store.put(value, certCacheKey))
}

async function deleteCachedCertInfo() {
  await withCertCacheStore('readwrite', (store) => store.delete(certCacheKey))
}

async function fileToCachedData(nextFile: File): Promise<CachedFileData> {
  return {
    name: nextFile.name,
    type: nextFile.type,
    lastModified: nextFile.lastModified,
    data: await nextFile.arrayBuffer(),
  }
}

function cachedDataToFile(nextFile: CachedFileData) {
  return new File([nextFile.data], nextFile.name, {
    type: nextFile.type,
    lastModified: nextFile.lastModified,
  })
}

function defaultOutputName(ipa?: File | null) {
  if (!ipa) return ''
  const base = ipa.name.replace(/\.(ipa|zip)$/i, '')
  return `${base || 'app'}_signed.ipa`
}

function cleanLogLine(line: string) {
  return line.replace(/\x1b\[[0-9;]*m/g, '').trim()
}

function logLevelFor(line: string): LogLevel {
  const clean = cleanLogLine(line).toLowerCase()
  if (clean.includes('error') || clean.includes('trap') || clean.includes('failed')) return 'error'
  if (clean.includes('warn') || clean.includes('no enough')) return 'warn'
  if (clean.includes('ok') || clean.includes('success') || clean.includes('done')) return 'success'
  if (clean.startsWith('>>>')) return 'step'
  return 'info'
}

function parseInstallMetadataLine(line: string) {
  const match = cleanLogLine(line).match(/^>>>\s*(AppName|BundleId|Version):\s*(.+)$/i)
  if (!match) return null

  const [, key, value] = match
  if (key.toLowerCase() === 'appname') return { appName: value.trim() }
  if (key.toLowerCase() === 'bundleid') return { bundleId: value.trim() }
  if (key.toLowerCase() === 'version') return { version: value.trim() }
  return null
}

function signingProgressForLine(line: string, current: ProgressState): ProgressState {
  const clean = cleanLogLine(line).toLowerCase()
  if (clean.includes('storage: browser disk mode')) return { value: Math.max(current.value, 8), label: 'Preparing low-memory browser storage' }
  if (clean.includes('unzip:')) return { value: Math.max(current.value, 12), label: 'Unzipping IPA locally' }
  if (clean.includes('unzip ok')) return { value: Math.max(current.value, 25), label: 'IPA extracted' }
  if (clean.includes('signing:')) return { value: Math.max(current.value, 34), label: 'Preparing app signature' }
  if (clean.includes('signfile:')) return { value: Math.min(82, Math.max(current.value + 2, 42)), label: 'Signing app binaries' }
  if (clean.includes('signfolder:')) return { value: Math.min(88, Math.max(current.value + 3, 66)), label: 'Writing bundle signatures' }
  if (clean.includes('signed ok')) return { value: Math.max(current.value, 88), label: 'Signature complete' }
  if (clean.includes('archiving:')) return { value: Math.max(current.value, 94), label: 'Archiving signed IPA' }
  if (clean.includes('archive ok')) return { value: Math.max(current.value, 98), label: 'Archive complete' }
  return current
}

function ProgressBar({ progress }: { progress: ProgressState }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{progress.label}</span>
        <span className="tabular-nums">{progress.value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${progress.value}%` }}
        />
      </div>
    </div>
  )
}

function formatHistoryDate(value: string) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function isExpired(entry: IpaHistoryEntry) {
  return Boolean(entry.expiresAt && Date.now() > new Date(entry.expiresAt).getTime())
}

function StatusTag({ children, tone }: { children: React.ReactNode; tone: 'local' | 'active' | 'expired' }) {
  const toneClass =
    tone === 'local'
      ? 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300'
      : tone === 'active'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
        : 'border-muted-foreground/20 bg-muted text-muted-foreground'

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${toneClass}`}>
      {children}
    </span>
  )
}

function PreviousIpasDialog({
  entries,
  onClose,
  onClear,
}: {
  entries: IpaHistoryEntry[]
  onClose: () => void
  onClear: () => void
}) {
  const [copiedId, setCopiedId] = React.useState('')

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const copyValue = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value)
    setCopiedId(id)
    window.setTimeout(() => setCopiedId(''), 1400)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="previous-ipas-title"
    >
      <div className="flex max-h-[min(92svh,760px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <AnimateIcon animateOnHover>
              <ClipboardList size={24} className="text-muted-foreground transition-colors hover:text-blue-500" />
            </AnimateIcon>
            <div>
              <h2 id="previous-ipas-title" className="text-lg font-semibold">
                Previous IPAs
              </h2>
              <p className="text-sm text-muted-foreground">
                Local history of signed names and temporary install links.
              </p>
            </div>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="min-h-0 overflow-y-auto p-5">
          {entries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
              No signed IPA history yet.
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => {
                const expired = isExpired(entry)
                const hasLinks = Boolean(entry.ipaUrl && entry.installUrl)

                return (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-border bg-background px-4 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{entry.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Signed {formatHistoryDate(entry.signedAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {!hasLinks ? (
                          <StatusTag tone="local">Fully Local</StatusTag>
                        ) : (
                          <>
                            <StatusTag tone={expired ? 'expired' : 'active'}>
                              {expired ? 'Expired' : 'Active'}
                            </StatusTag>
                            <StatusTag tone="local">
                              Litterbox {entry.uploadExpiry}
                            </StatusTag>
                          </>
                        )}
                      </div>
                    </div>

                    {entry.metadata?.bundleId && (
                      <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
                        {entry.metadata.bundleId}
                      </p>
                    )}

                    {hasLinks && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <AnimateIcon animateOnHover asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              copyValue(`${entry.id}-ipa`, entry.ipaUrl ?? '')
                            }
                            className="gap-2"
                          >
                            <Copy size={14} />
                            {copiedId === `${entry.id}-ipa`
                              ? 'Copied URL'
                              : 'Copy Download URL'}
                          </Button>
                        </AnimateIcon>
                        <AnimateIcon animateOnHover asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              copyValue(`${entry.id}-install`, entry.installUrl ?? '')
                            }
                            className="gap-2"
                          >
                            <Copy size={14} />
                            {copiedId === `${entry.id}-install`
                              ? 'Copied Link'
                              : 'Copy iPhone Install Link'}
                          </Button>
                        </AnimateIcon>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {entries.length > 0 && (
          <div className="flex justify-end border-t border-border px-5 py-3">
            <AnimateIcon animateOnHover asChild>
              <Button
                type="button"
                variant="ghost"
                onClick={onClear}
                className="gap-2 text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={16} />
                Clear History
              </Button>
            </AnimateIcon>
          </div>
        )}
      </div>
    </div>
  )
}

function WelcomeLottie() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    DotLottie.setWasmUrl('/dotlottie-player.wasm')
    const player = new DotLottie({
      canvas,
      src: '/hello-apple.lottie',
      autoplay: true,
      loop: true,
      renderConfig: {
        autoResize: true,
      },
    })

    return () => player.destroy()
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="size-full brightness-0 invert"
      aria-label="Welcome animation"
    />
  )
}

function WelcomeDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="px-6 pt-3">
          <div className="mx-auto size-64 md:size-72">
            <WelcomeLottie />
          </div>
        </div>

        <div className="-mt-12 space-y-4 px-6 pb-6 text-center md:-mt-16">
          <div>
            <h2 id="welcome-title" className="text-2xl font-semibold tracking-tight">
              Hey there 👋
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Sylva Signer is a browser-based proof of concept for local IPA signing.
              Large files can take time because extraction, signing, and archiving happen
              on this device. Supported mobile browsers and large-file jobs use
              browser-managed storage to reduce memory pressure. Direct iPhone
              installation requires an
              HTTPS-hosted IPA, so the built-in QR flow uploads only the signed IPA to a
              temporary provider after your explicit agreement.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
            <a
              href="https://github.com/AntonP29"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <GithubIcon size={14} />
              AntonP29
            </a>
            <span>June 17th, 2026</span>
          </div>

          <Button type="button" onClick={onClose} className="w-full">
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}

function LegalFooter() {
  return (
    <footer className="mt-12 border-t border-border pt-6 text-center text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4">
        <p className="italic leading-5">
          Sylva Signer runs zsign as WebAssembly inside a dedicated browser worker. Your IPA,
          certificate, provisioning profile, password, and signed output remain on this device
          during signing; QR install uploads only the signed IPA after confirmation.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-y border-border/70 py-3 text-foreground/70">
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            Powered by
            <a
              className="font-medium text-sky-300 transition-colors hover:text-sky-200 hover:underline"
              href="https://github.com/zhlynn/zsign"
              target="_blank"
              rel="noreferrer"
            >
              zsign
            </a>
            <span>(Private WASM port)</span>
          </span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className="mr-2 font-semibold text-foreground/60" aria-hidden="true">
              |
            </span>
            Temporary hosting by
            <a
              className="font-medium text-sky-300 transition-colors hover:text-sky-200 hover:underline"
              href="https://litterbox.catbox.moe/"
              target="_blank"
              rel="noreferrer"
            >
              Litterbox
            </a>
          </span>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <a className="transition-colors hover:text-red-500" href="#privacy">
            Privacy Policy
          </a>
          <a className="transition-colors hover:text-blue-500" href="#legal">
            Legal
          </a>
          <a
            className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            href="https://github.com/AntonP29"
            target="_blank"
            rel="noreferrer"
          >
            <GithubIcon size={14} />
            AntonP29
          </a>
        </nav>
      </div>
    </footer>
  )
}

function InfoPage({ route }: { route: Exclude<Route, 'app'> }) {
  const isPrivacy = route === 'privacy'

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col px-5 py-8 md:px-8 md:py-12">
      <header className="flex items-center justify-between gap-4">
        <a href="#" className="flex items-center gap-3.5">
          <div className="relative size-12 shrink-0 overflow-hidden rounded-2xl shadow-sm md:size-14">
            <img
              src="/icon-light.png"
              alt="Sylva Signer logo"
              className="size-full scale-[1.18] object-cover dark:hidden"
            />
            <img
              src="/icon-dark.png"
              alt=""
              aria-hidden
              className="hidden size-full scale-[1.18] object-cover dark:block"
            />
          </div>
          <div>
            <h1 className="text-balance text-xl font-semibold tracking-tight md:text-2xl">
              Sylva Signer
            </h1>
            <p className="text-sm text-muted-foreground">Fully local IPA signing</p>
          </div>
        </a>
        <ThemeToggle />
      </header>

      <Separator className="my-8" />

      <section className="rounded-2xl border border-border bg-card p-6 md:p-8">
        <div className="mb-6 flex items-center gap-3">
          <AnimateIcon animateOnHover>
            {isPrivacy ? (
              <Lock size={28} className="text-muted-foreground transition-colors hover:text-blue-500" />
            ) : (
              <ClipboardList
                size={28}
                className="text-muted-foreground transition-colors hover:text-emerald-500"
              />
            )}
          </AnimateIcon>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {isPrivacy ? 'Privacy Policy' : 'Legal Notice'}
            </p>
            <h2 className="text-2xl font-semibold tracking-tight">
              {isPrivacy ? 'Privacy Policy' : 'Legal'}
            </h2>
          </div>
        </div>

        <div className="space-y-4 text-sm leading-7 text-muted-foreground">
          {isPrivacy ? (
            <>
              <p>
                Sylva Signer is designed to sign IPA files locally in your browser. The app
                does not require a signing server and does not intentionally upload your IPA,
                P12/PFX certificate, provisioning profile, password, or dylibs. If you choose
                QR install after signing, only the signed IPA is uploaded temporarily so iOS can
                fetch it over HTTPS.
              </p>
              <p>
                Optional certificate caching stores selected signing material and password
                data in this browser&apos;s IndexedDB storage on this device. You can clear
                that cache from the signer interface.
              </p>
              <p>
                If you use a hosted copy, your browser still downloads the application code
                from that host. Use a build and domain you trust.
              </p>
            </>
          ) : (
            <>
              <p>
                Sylva Signer is provided as a browser-based signing tool for lawful workflows
                using certificates, provisioning profiles, and app files you are authorized to
                use.
              </p>
              <p>
                You are responsible for complying with Apple developer terms, software
                licenses, distribution rules, and all applicable laws. This project does not
                provide Apple certificates, provisioning profiles, entitlements, or third-party
                app assets.
              </p>
              <p>
                This project is made by AntonP29 and published for local, privacy-preserving
                IPA signing research and utility.
              </p>
            </>
          )}
        </div>

        <a
          href="https://github.com/AntonP29"
          target="_blank"
          rel="noreferrer"
          className="mt-7 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground"
        >
          <GithubIcon size={16} />
          Visit AntonP29 on GitHub
        </a>
      </section>

      <LegalFooter />
    </main>
  )
}

function SignerApp() {
  const [ipa, setIpa] = React.useState<File[]>([])
  const [p12, setP12] = React.useState<File[]>([])
  const [profiles, setProfiles] = React.useState<File[]>([])
  const [dylibs, setDylibs] = React.useState<File[]>([])

  const [certPassword, setCertPassword] = React.useState('')
  const [outputName, setOutputName] = React.useState('')
  const [bundleId, setBundleId] = React.useState('')
  const [cacheCert, setCacheCert] = React.useState(false)
  const [cachedCertInfo, setCachedCertInfo] = React.useState<CachedCertInfo | null>(null)
  const [outputNameTouched, setOutputNameTouched] = React.useState(false)

  const [logs, setLogs] = React.useState<LogEntry[]>([])
  const [state, setState] = React.useState<SignState>('idle')
  const [outputs, setOutputs] = React.useState<OutputFile[]>([])
  const [installMetadata, setInstallMetadata] = React.useState<Partial<InstallMetadata>>({})
  const [installDialogOpen, setInstallDialogOpen] = React.useState(false)
  const [signProgress, setSignProgress] = React.useState<ProgressState>({
    value: 0,
    label: 'Waiting to sign',
  })
  const [consoleActivity, setConsoleActivity] = React.useState<ConsoleActivity | null>(null)
  const [historyEntries, setHistoryEntries] = React.useState<IpaHistoryEntry[]>([])
  const [historyDialogOpen, setHistoryDialogOpen] = React.useState(false)
  const [welcomeOpen, setWelcomeOpen] = React.useState(true)
  const [currentHistoryId, setCurrentHistoryId] = React.useState('')
  const installMetadataRef = React.useRef<Partial<InstallMetadata>>({})

  const canSign = Boolean(ipa[0] && (p12[0] || cachedCertInfo?.p12) && (profiles.length || cachedCertInfo?.profiles.length)) && state !== 'signing'
  const hasCache = Boolean(cachedCertInfo?.p12 || cachedCertInfo?.profiles.length || cachedCertInfo?.password)
  const firstOutput = outputs.find((output) => output.name.toLowerCase().endsWith('.ipa')) ?? outputs[0]

  React.useEffect(() => {
    setHistoryEntries(readIpaHistory())
  }, [])

  const hydrateCachedFiles = React.useCallback((cached: CachedCertInfo | null) => {
    if (!cached) return
    setP12((current) => (current.length === 0 && cached.p12 ? [cachedDataToFile(cached.p12)] : current))
    setProfiles((current) =>
      current.length === 0 && cached.profiles.length > 0
        ? cached.profiles.map(cachedDataToFile)
        : current,
    )
    if (cached.password) setCertPassword((current) => current || cached.password || '')
  }, [])

  React.useEffect(() => {
    void readCachedCertInfo()
      .then((cached) => {
        setCachedCertInfo(cached)
        hydrateCachedFiles(cached)
        if (cached?.p12 || cached?.profiles.length || cached?.password) setCacheCert(true)
      })
      .catch(() => setCachedCertInfo(null))
  }, [hydrateCachedFiles])

  React.useEffect(() => {
    if (cacheCert) hydrateCachedFiles(cachedCertInfo)
  }, [cacheCert, cachedCertInfo, hydrateCachedFiles])

  React.useEffect(() => {
    if (!outputNameTouched) setOutputName(defaultOutputName(ipa[0]))
  }, [ipa, outputNameTouched])

  const addLog = React.useCallback((level: LogLevel, message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false })
    setLogs((prev) => [...prev, { id: ++logCounter, time, level, message }])
  }, [])

  const addWorkerLog = React.useCallback(
    (line: string) => {
      const cleanLine = cleanLogLine(line).toLowerCase()
      if (cleanLine.includes('unzip ok') || cleanLine.includes('archive ok')) {
        setConsoleActivity(null)
      }
      const parsedMetadata = parseInstallMetadataLine(line)
      if (parsedMetadata) {
        installMetadataRef.current = { ...installMetadataRef.current, ...parsedMetadata }
        setInstallMetadata(installMetadataRef.current)
      }
      setSignProgress((current) => signingProgressForLine(line, current))
      addLog(logLevelFor(line), cleanLogLine(line))
    },
    [addLog],
  )

  const updateWorkerProgress = React.useCallback((progress: ZsignProgress) => {
    const ratio = progress.total > 0 ? Math.min(1, progress.completed / progress.total) : 1
    const percent = Math.round(ratio * 100)
    if (progress.phase === 'extract') {
      setConsoleActivity({ label: 'Unzipping IPA locally', percent })
      setSignProgress({ value: Math.round(10 + ratio * 15), label: 'Streaming IPA into browser storage' })
    } else {
      setConsoleActivity({ label: 'Compressing signed IPA', percent })
      setSignProgress({ value: Math.round(90 + ratio * 9), label: 'Compressing signed IPA' })
    }
  }, [])

  const saveCertCacheFromInputs = React.useCallback(async () => {
    const next: CachedCertInfo = {
      p12: p12[0] ? await fileToCachedData(p12[0]) : cachedCertInfo?.p12,
      profiles: profiles.length
        ? await Promise.all(profiles.map(fileToCachedData))
        : cachedCertInfo?.profiles ?? [],
      password: certPassword || cachedCertInfo?.password,
      savedAt: Date.now(),
    }

    if (!next.p12 && next.profiles.length === 0 && !next.password) return
    await writeCachedCertInfo(next)
    setCachedCertInfo(next)
  }, [cachedCertInfo, certPassword, p12, profiles])

  const handleClearCache = React.useCallback(async () => {
    await deleteCachedCertInfo()
    setCachedCertInfo(null)
    setCacheCert(false)
    setP12([])
    setProfiles([])
    setCertPassword('')
    addLog('success', 'Cached certificate information cleared')
  }, [addLog])

  const buildSignOptions = React.useCallback((): SignIpaOptions => {
    if (!ipa[0]) throw new Error('Choose an IPA before signing.')

    const cachedP12 = cachedCertInfo?.p12 ? cachedDataToFile(cachedCertInfo.p12) : undefined
    const cachedProfiles = cachedCertInfo?.profiles.map(cachedDataToFile) ?? []
    const selectedP12 = p12[0] ?? (cacheCert ? cachedP12 : undefined)
    const selectedProfiles = profiles.length > 0 ? profiles : cacheCert ? cachedProfiles : []

    if (!selectedP12) throw new Error('Choose a P12/PFX signing certificate.')
    if (selectedProfiles.length === 0) throw new Error('Choose at least one provisioning profile.')

    return {
      ipa: ipa[0],
      p12: selectedP12,
      profiles: selectedProfiles,
      dylibs,
      password: certPassword || (cacheCert ? cachedCertInfo?.password ?? '' : ''),
      outputName: outputName.trim() || defaultOutputName(ipa[0]),
      bundleId: bundleId.trim(),
      zipLevel: 6,
      metadata: false,
    }
  }, [bundleId, cacheCert, cachedCertInfo, certPassword, dylibs, ipa, outputName, p12, profiles])

  const handleSign = async () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setState('signing')
    setLogs([])
    setOutputs([])
    setInstallMetadata({})
    installMetadataRef.current = {}
    setInstallDialogOpen(false)
    setCurrentHistoryId('')
    setConsoleActivity(null)
    setSignProgress({ value: 5, label: 'Starting local signing session' })

    try {
      if (cacheCert) await saveCertCacheFromInputs()

      addLog('step', 'Initializing local WebAssembly signing session')
      addLog('info', `Loaded payload: ${ipa[0]?.name ?? 'pending'}`)
      const signOptions = buildSignOptions()
      const compatibility = await resolveProvisioningCompatibility(
        signOptions.profiles ?? [],
        signOptions.bundleId,
        signOptions.removeExtensions,
      )
      signOptions.bundleId = compatibility.bundleId
      signOptions.removeExtensions = compatibility.removeExtensions
      compatibility.notices.forEach((notice) => addLog('warn', notice))

      const result = await signIpa(signOptions, {
        onLog: addWorkerLog,
        onProgress: updateWorkerProgress,
      })

      setOutputs(result.outputs)
      if (result.exitCode === 0) {
        const signedOutput =
          result.outputs.find((output) => output.name.toLowerCase().endsWith('.ipa')) ??
          result.outputs[0]
        if (signedOutput) {
          const entry = createLocalHistoryEntry(signedOutput.name, installMetadataRef.current)
          setCurrentHistoryId(entry.id)
          setHistoryEntries(upsertIpaHistoryEntry(entry))
        }
      }
      addLog(result.exitCode === 0 ? 'success' : 'error', `zsign exited with code ${result.exitCode}`)
      setSignProgress((current) => ({
        value: result.exitCode === 0 ? 100 : Math.max(current.value, 1),
        label: result.exitCode === 0 ? 'Signing complete' : 'Signing stopped',
      }))
      setState(result.exitCode === 0 ? 'done' : 'error')
      setConsoleActivity(null)
    } catch (error) {
      addLog('error', error instanceof Error ? error.message : String(error))
      setSignProgress((current) => ({
        value: Math.max(current.value, 1),
        label: 'Signing failed',
      }))
      setState('error')
      setConsoleActivity(null)
    }
  }

  const handleDownload = () => {
    if (!firstOutput) return
    saveOutput(firstOutput)
    addLog('success', `Download started: ${firstOutput.name}`)
  }

  const handleClear = () => {
    setIpa([])
    setP12([])
    setProfiles([])
    setDylibs([])
    setOutputName('')
    setOutputNameTouched(false)
    setBundleId('')
    setOutputs([])
    setLogs([])
    setInstallMetadata({})
    installMetadataRef.current = {}
    setInstallDialogOpen(false)
    setCurrentHistoryId('')
    setSignProgress({ value: 0, label: 'Waiting to sign' })
    setConsoleActivity(null)
    if (!cacheCert) setCertPassword('')
    setState('idle')
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-5 py-8 md:px-8 md:py-12">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="relative size-12 shrink-0 overflow-hidden rounded-2xl shadow-sm md:size-14">
            <img
              src="/icon-light.png"
              alt="Sylva Signer logo"
              className="size-full scale-[1.18] object-cover dark:hidden"
            />
            <img
              src="/icon-dark.png"
              alt=""
              aria-hidden
              className="hidden size-full scale-[1.18] object-cover dark:block"
            />
          </div>
          <div>
            <h1 className="text-balance text-xl font-semibold tracking-tight md:text-2xl">
              Sylva Signer
            </h1>
            <p className="text-sm text-muted-foreground">
              Fully local IPA signing in your browser
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AnimateIcon animateOnHover asChild>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setHistoryEntries(readIpaHistory())
                setHistoryDialogOpen(true)
              }}
              aria-label="Previous IPAs"
              title="Previous IPAs"
              className="size-9 gap-2 px-0 sm:w-auto sm:px-2.5"
            >
              <ClipboardList size={16} />
              <span className="hidden sm:inline">Previous IPAs</span>
            </Button>
          </AnimateIcon>
          <ThemeToggle />
        </div>
      </header>

      <Separator className="my-8" />

      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <AnimateIcon animateOnHover>
                <Layers
                  size={18}
                  className="text-muted-foreground transition-colors hover:text-blue-500"
                />
              </AnimateIcon>
              <h2 className="text-sm font-semibold tracking-tight">Inputs</h2>
            </div>

            <FileDrop
              id="ipa"
              label="IPA file"
              hint="Select or drop your .ipa"
              accept=".ipa,.zip"
              icon={Layers}
              hoverColor="group-hover:text-blue-500"
              files={ipa}
              onFiles={setIpa}
            />
            <FileDrop
              id="p12"
              label="Signing certificate (.p12)"
              hint="Select or drop your .p12"
              accept=".p12,.pfx"
              icon={BadgeCheck}
              hoverColor="group-hover:text-emerald-500"
              files={p12}
              onFiles={setP12}
            />
            <FileDrop
              id="profiles"
              label="Provisioning profile"
              hint="Select or drop .mobileprovision"
              accept=".mobileprovision,.provisionprofile"
              multiple
              icon={LockKeyhole}
              hoverColor="group-hover:text-amber-500"
              files={profiles}
              onFiles={setProfiles}
            />
            <FileDrop
              id="dylibs"
              label="Dylibs (optional)"
              hint="Select or drop .dylib files to inject"
              accept=".dylib"
              multiple
              icon={Blocks}
              hoverColor="group-hover:text-rose-500"
              files={dylibs}
              onFiles={setDylibs}
            />
          </section>

          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <AnimateIcon animateOnHover>
                <Key
                  size={18}
                  className="text-muted-foreground transition-colors hover:text-violet-500"
                />
              </AnimateIcon>
              <h2 className="text-sm font-semibold tracking-tight">
                Credentials &amp; Options
              </h2>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="cert-password">Certificate password</Label>
              <Input
                id="cert-password"
                type="password"
                placeholder="Enter .p12 password"
                value={certPassword}
                onChange={(e) => setCertPassword(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="output-name">Output IPA name</Label>
                <Input
                  id="output-name"
                  placeholder="e.g. my-app-signed.ipa"
                  value={outputName}
                  onChange={(e) => {
                    setOutputNameTouched(true)
                    setOutputName(e.target.value)
                  }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="bundle-id">Custom bundle ID</Label>
                <Input
                  id="bundle-id"
                  placeholder="Original when profile permits"
                  value={bundleId}
                  onChange={(e) => setBundleId(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 px-4 py-3">
              <AnimateIcon animateOnHover asChild>
                <label
                  htmlFor="cache-cert"
                  className="group flex flex-1 cursor-pointer items-center gap-3"
                >
                  <Fingerprint
                    size={20}
                    className="text-muted-foreground transition-colors group-hover:text-cyan-500"
                  />
                  <div>
                    <p className="text-sm font-medium">Cache certificate locally</p>
                    <p className="text-xs text-muted-foreground">
                      Remember signing assets in this browser
                    </p>
                  </div>
                </label>
              </AnimateIcon>
              <Switch
                id="cache-cert"
                checked={cacheCert}
                onCheckedChange={setCacheCert}
              />
            </div>

            {hasCache && (
              <AnimateIcon animateOnHover asChild>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleClearCache}
                  className="w-fit gap-2 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={16} />
                  Forget cached certificate
                </Button>
              </AnimateIcon>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <AnimateIcon
              animate={state === 'signing'}
              animateOnHover
              loop={state === 'signing'}
              asChild
            >
              <Button
                id="sign-button"
                size="lg"
                onClick={handleSign}
                disabled={!canSign}
                className="h-11 gap-2 px-5"
              >
                {state === 'signing' ? (
                  <LoaderCircle size={18} animate loop />
                ) : (
                  <Send size={18} />
                )}
                {state === 'signing' ? 'Signing...' : 'Sign IPA'}
              </Button>
            </AnimateIcon>

            <AnimateIcon animateOnHover asChild>
              <Button
                size="lg"
                variant="outline"
                onClick={handleDownload}
                disabled={outputs.length === 0}
                className="h-11 gap-2 px-5"
              >
                <Download size={18} />
                Download
              </Button>
            </AnimateIcon>

            <AnimateIcon animateOnHover asChild>
              <Button
                size="lg"
                variant="ghost"
                onClick={handleClear}
                className="h-11 gap-2 px-5 text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={18} />
                Clear
              </Button>
            </AnimateIcon>
          </div>

          {(state === 'signing' || state === 'done' || state === 'error') && (
            <ProgressBar progress={signProgress} />
          )}

          <p className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs leading-5 text-muted-foreground">
            Large IPAs can be slow because unzipping, signing, and re-archiving happen
            locally. Supported mobile browsers and large-file jobs use lower-memory
            browser storage automatically. Keep this tab open and ensure the device has
            enough free storage. QR install uploads the signed IPA only after you confirm.
          </p>
        </div>

        <div className="flex min-h-[420px] min-w-0 flex-col lg:min-h-0">
          <div className="h-[420px] max-h-[520px] lg:h-[calc(100vh-12rem)] lg:max-h-[680px]">
            <LogConsole
              logs={logs}
              active={state === 'signing'}
              activity={consoleActivity}
            />
          </div>

          {state === 'done' && outputs.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-600 dark:text-emerald-400">
              <CircleCheckBig size={20} animate />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Signing complete</p>
                <p className="truncate text-xs opacity-80">
                  {outputs[0]?.name ?? outputName} is ready to download
                </p>
              </div>
              <AnimateIcon animateOnHover asChild>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setInstallDialogOpen(true)}
                  className="gap-2 border-emerald-500/30 bg-background/70 text-foreground hover:bg-background"
                >
                  <Send size={16} />
                  Install QR
                </Button>
              </AnimateIcon>
            </div>
          )}

          {outputs.length > 0 && (
            <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-sm font-medium">Signed output</p>
              {outputs.map((output) => (
                <button
                  key={output.path}
                  type="button"
                  onClick={() => saveOutput(output)}
                  className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  <span className="min-w-0 truncate">{output.name}</span>
                  <Download size={16} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {installDialogOpen && firstOutput && (
        <InstallQrDialog
          output={firstOutput}
          initialMetadata={installMetadata}
          onClose={() => setInstallDialogOpen(false)}
          onLog={(message) => addLog(logLevelFor(message), message)}
          onUploaded={(result, expiry) => {
            if (!currentHistoryId) return
            setHistoryEntries(updateHistoryEntryUpload(currentHistoryId, result, expiry))
          }}
        />
      )}

      {historyDialogOpen && (
        <PreviousIpasDialog
          entries={historyEntries}
          onClose={() => setHistoryDialogOpen(false)}
          onClear={() => {
            clearIpaHistory()
            setHistoryEntries([])
          }}
        />
      )}

      {welcomeOpen && <WelcomeDialog onClose={() => setWelcomeOpen(false)} />}

      <LegalFooter />
    </main>
  )
}

export function SylvaSigner() {
  const route = useRoute()

  if (route === 'privacy' || route === 'legal') {
    return <InfoPage route={route} />
  }

  return <SignerApp />
}
