import { existsSync, readFileSync, readdirSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const requiredFiles = [
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'licenses/animate-ui.txt',
  'licenses/openssl-3.5.7.txt',
  'public/fonts/inter/OFL.txt',
  'src/components/animate-ui/NOTICE.md',
  'vendor/zsign/LICENSE',
]
const forbiddenFiles = [
  'public/hello-apple.lottie',
  'public/dotlottie-player.wasm',
  'public/fonts/sf-pro-display',
]

const missing = requiredFiles.filter((path) => !existsSync(new URL(path, root)))
const forbidden = forbiddenFiles.filter((path) => existsSync(new URL(path, root)))
const copiedLicenses = new Set(
  readdirSync(new URL('licenses/npm/', root)).filter((name) => name.endsWith('.txt')),
)
const missingPackageLicenses = Object.keys(packageJson.dependencies ?? {}).filter((name) => {
  const file = `${name.replace('@', '').replaceAll('/', '__')}.txt`
  return !copiedLicenses.has(file)
})
const styles = readFileSync(new URL('src/styles.css', root), 'utf8')

if (packageJson.license !== 'MIT') missing.push('package.json license=MIT')
if (styles.includes('SF Pro')) forbidden.push('SF Pro reference in src/styles.css')
if (missing.length || forbidden.length || missingPackageLicenses.length) {
  if (missing.length) console.error(`Missing required notices: ${missing.join(', ')}`)
  if (forbidden.length) console.error(`Removed assets found: ${forbidden.join(', ')}`)
  if (missingPackageLicenses.length) {
    console.error(`Direct packages without copied licenses: ${missingPackageLicenses.join(', ')}`)
  }
  process.exit(1)
}

console.log(
  `License check OK: ${copiedLicenses.size} direct runtime package notices and copied component notices present.`,
)
