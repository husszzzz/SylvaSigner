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
const litterboxMaxFileSize = 1024 * 1024 * 1024
const paleraManifestEndpoint = 'https://api.palera.in/genPlist'

function isAppleMobileBrowser() {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  )
}

function uploadFormWithXhr(form: FormData) {
  return new Promise<{ ok: boolean; status: number; text: string }>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', litterboxEndpoint)
    request.onload = () => {
      resolve({
        ok: request.status >= 200 && request.status < 300,
        status: request.status,
        text: request.responseText.trim(),
      })
    }
    request.onerror = () => {
      reject(
        new Error(
          'Mobile Safari could not connect to Litterbox. Check content blockers, Private Relay, or the current network and retry.',
        ),
      )
    }
    request.onabort = () => reject(new Error('The Litterbox upload was cancelled.'))
    // Do not attach xhr.upload listeners: they trigger a preflight that Litterbox rejects.
    request.send(form)
  })
}

async function uploadFormWithFetch(form: FormData) {
  const response = await fetch(litterboxEndpoint, {
    method: 'POST',
    body: form,
  })
  return {
    ok: response.ok,
    status: response.status,
    text: (await response.text()).trim(),
  }
}

export async function uploadSignedIpaToLitterbox(
  output: OutputFile,
  expiry: LitterboxExpiry = '1h',
) {
  const outputSize = output.data instanceof Blob ? output.data.size : output.data.byteLength
  if (outputSize > litterboxMaxFileSize) {
    throw new Error('Litterbox accepts files up to 1 GB. Choose a smaller signed IPA.')
  }

  const blob = output.data instanceof Blob
    ? output.data
    : new Blob([output.data], { type: output.type || 'application/octet-stream' })
  const fileName = output.name.toLowerCase().endsWith('.ipa')
    ? output.name
    : `${output.name}.ipa`

  const form = new FormData()
  form.append('reqtype', 'fileupload')
  form.append('time', expiry)
  form.append('fileToUpload', blob, fileName)

  const response = isAppleMobileBrowser()
    ? await uploadFormWithXhr(form)
    : await uploadFormWithFetch(form)

  if (!response.ok) {
    throw new Error(`Litterbox upload failed with HTTP ${response.status}.`)
  }

  if (!response.text.startsWith(litterboxHost)) {
    throw new Error(response.text || 'Litterbox did not return a temporary file URL.')
  }

  return response.text
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
