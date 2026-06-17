'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'

import { FileDrop } from '@/components/file-drop'
import {
  LogConsole,
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
import { Lock } from '@/components/animate-ui/icons/lock'
import { ClipboardList } from '@/components/animate-ui/icons/clipboard-list'
import { saveOutput, signIpa } from '@/zsign-api'
import type { OutputFile, SignIpaOptions } from '@/types'

type SignState = 'idle' | 'signing' | 'done' | 'error'
type Route = 'app' | 'privacy' | 'legal'

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

function LegalFooter() {
  return (
    <footer className="mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-center text-xs text-muted-foreground">
      <a className="transition-colors hover:text-blue-500" href="#privacy">
        Privacy Policy
      </a>
      <a className="transition-colors hover:text-emerald-500" href="#legal">
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
                P12/PFX certificate, provisioning profile, password, dylibs, or signed output.
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

  const canSign = Boolean(ipa[0] && (p12[0] || cachedCertInfo?.p12) && (profiles.length || cachedCertInfo?.profiles.length)) && state !== 'signing'
  const hasCache = Boolean(cachedCertInfo?.p12 || cachedCertInfo?.profiles.length || cachedCertInfo?.password)

  React.useEffect(() => {
    void readCachedCertInfo()
      .then((cached) => {
        setCachedCertInfo(cached)
        if (cached?.password) setCertPassword(cached.password)
        if (cached?.p12 || cached?.profiles.length || cached?.password) setCacheCert(true)
      })
      .catch(() => setCachedCertInfo(null))
  }, [])

  React.useEffect(() => {
    if (!outputNameTouched) setOutputName(defaultOutputName(ipa[0]))
  }, [ipa, outputNameTouched])

  const addLog = React.useCallback((level: LogLevel, message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false })
    setLogs((prev) => [...prev, { id: ++logCounter, time, level, message }])
  }, [])

  const addWorkerLog = React.useCallback(
    (line: string) => addLog(logLevelFor(line), cleanLogLine(line)),
    [addLog],
  )

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
      zipLevel: 0,
      metadata: false,
    }
  }, [bundleId, cacheCert, cachedCertInfo, certPassword, dylibs, ipa, outputName, p12, profiles])

  const handleSign = async () => {
    setState('signing')
    setLogs([])
    setOutputs([])

    try {
      if (cacheCert) await saveCertCacheFromInputs()

      addLog('step', 'Initializing local WebAssembly signing session')
      addLog('info', `Loaded payload: ${ipa[0]?.name ?? 'pending'}`)
      const result = await signIpa(buildSignOptions(), { onLog: addWorkerLog })

      setOutputs(result.outputs)
      addLog(result.exitCode === 0 ? 'success' : 'error', `zsign exited with code ${result.exitCode}`)
      setState(result.exitCode === 0 ? 'done' : 'error')
    } catch (error) {
      addLog('error', error instanceof Error ? error.message : String(error))
      setState('error')
    }
  }

  const handleDownload = () => {
    const firstOutput = outputs.find((output) => output.name.toLowerCase().endsWith('.ipa')) ?? outputs[0]
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
        <ThemeToggle />
      </header>

      <Separator className="my-8" />

      <section className="mb-6 grid gap-3 md:grid-cols-[1fr_0.9fr] md:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Private by design
          </p>
          <h2 className="mt-2 text-balance text-3xl font-semibold tracking-tight md:text-4xl">
            Sign IPA files locally with your own certificate.
          </h2>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          Sylva Signer runs zsign as WebAssembly inside a dedicated browser worker.
          Your IPA, P12/PFX certificate, provisioning profile, password, dylibs, and
          signed output remain on this device.
        </p>
      </section>

      <div className="grid flex-1 gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div className="flex flex-col gap-6">
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
                  placeholder="Leave blank for original"
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
        </div>

        <div className="flex min-h-[420px] flex-col lg:min-h-0">
          <div className="flex-1">
            <LogConsole logs={logs} />
          </div>

          {state === 'done' && outputs.length > 0 && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-600 dark:text-emerald-400">
              <CircleCheckBig size={20} animate />
              <div className="min-w-0">
                <p className="text-sm font-medium">Signing complete</p>
                <p className="truncate text-xs opacity-80">
                  {outputs[0]?.name ?? outputName} is ready to download
                </p>
              </div>
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
