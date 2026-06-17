import type { OutputFile } from '@/types'

export type InstallMetadata = {
  appName: string
  bundleId: string
  version: string
}

export type LitterboxExpiry = '1h' | '12h' | '24h' | '72h'

export type TemporaryInstallResult = {
  ipaUrl: string
  manifestUrl: string
  installUrl: string
}

const litterboxEndpoint = 'https://litterbox.catbox.moe/resources/internals/api.php'
const litterboxHost = 'https://litter.catbox.moe/'
const paleraManifestEndpoint = 'https://api.palera.in/genPlist'

export async function uploadSignedIpaToLitterbox(
  output: OutputFile,
  expiry: LitterboxExpiry = '1h',
) {
  const blob = new Blob([output.data], {
    type: output.type || 'application/octet-stream',
  })
  const fileName = output.name.toLowerCase().endsWith('.ipa')
    ? output.name
    : `${output.name}.ipa`

  const form = new FormData()
  form.append('reqtype', 'fileupload')
  form.append('time', expiry)
  form.append('fileToUpload', new File([blob], fileName, { type: blob.type }))

  const response = await fetch(litterboxEndpoint, {
    method: 'POST',
    body: form,
  })
  const text = (await response.text()).trim()

  if (!response.ok) {
    throw new Error(`Litterbox upload failed with HTTP ${response.status}.`)
  }
  if (!text.startsWith(litterboxHost)) {
    throw new Error(text || 'Litterbox did not return a temporary file URL.')
  }

  return text
}

export function buildPaleraInstallUrls(
  metadata: InstallMetadata,
  ipaUrl: string,
): TemporaryInstallResult {
  const manifest = new URL(paleraManifestEndpoint)
  manifest.searchParams.set('bundleid', metadata.bundleId)
  manifest.searchParams.set('name', metadata.appName)
  manifest.searchParams.set('version', metadata.version)
  manifest.searchParams.set('fetchurl', ipaUrl)

  const manifestUrl = manifest.toString()

  return {
    ipaUrl,
    manifestUrl,
    installUrl: `itms-services://?action=download-manifest&url=${encodeURIComponent(
      manifestUrl,
    )}`,
  }
}
