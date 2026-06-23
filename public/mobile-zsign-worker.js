/* global createZsignModule, importScripts */

const runtimeVersion = 'wasm_28a6421_dylib_fix_v2'

function normalizePath(path) {
  const normalized = path.replaceAll('\\', '/')
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function dirname(path) {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf('/')
  return index <= 0 ? '/' : normalized.slice(0, index)
}

function basename(path) {
  return normalizePath(path).split('/').filter(Boolean).pop() || 'file'
}

function ensureDir(FS, path) {
  let current = ''
  for (const part of normalizePath(path).split('/').filter(Boolean)) {
    current += `/${part}`
    try {
      FS.mkdir(current)
    } catch (error) {
      if (error?.errno !== 20) throw error
    }
  }
}

function outputType(path) {
  return /\.(?:ipa|zip)$/i.test(path) ? 'application/zip' : 'application/octet-stream'
}

function cleanLine(value) {
  return String(value).replace(/\x1b\[[0-9;]*[mK]/g, '').trim()
}

self.onmessage = async (event) => {
  const request = event.data
  if (request?.type !== 'run') return
  const logs = []
  const transfers = []
  const emitLog = (value) => {
    const line = cleanLine(value)
    if (!line) return
    logs.push(line)
    self.postMessage({ id: request.id, type: 'log', ok: true, line })
  }

  try {
    importScripts(`/wasm/zsign-mobile.js?v=${runtimeVersion}`)
    const module = await createZsignModule({
      noInitialRun: true,
      locateFile(file) {
        return `/wasm/${file}?v=${runtimeVersion}`
      },
      print: emitLog,
      printErr: emitLog,
    })
    const { FS } = module
    ensureDir(FS, '/blob')
    ensureDir(FS, '/output')
    ensureDir(FS, '/tmp')
    ensureDir(FS, '/work/.zsign_cache')
    FS.chdir('/work')

    const workerFiles = request.files.filter((file) => file.mode === 'workerfs')
    if (workerFiles.length) {
      FS.mount(
        module.WORKERFS,
        { blobs: workerFiles.map((file) => ({ name: basename(file.path), data: file.file })) },
        '/blob',
      )
    }
    for (const file of request.files.filter((entry) => entry.mode !== 'workerfs')) {
      const path = normalizePath(file.path)
      ensureDir(FS, dirname(path))
      FS.writeFile(path, new Uint8Array(await file.file.arrayBuffer()), { canOwn: true })
    }

    emitLog('>>> Mobile mode: classic worker with native zsign archive pipeline')
    let exitCode = 0
    try {
      const result = module.callMain(request.args)
      if (Number.isInteger(result)) exitCode = result
    } catch (error) {
      if (Number.isInteger(error?.status)) exitCode = error.status
      else throw error
    }

    const outputs = []
    for (const requestedPath of request.options.outputPaths || []) {
      const path = normalizePath(requestedPath)
      const node = FS.analyzePath(path).object
      if (!node?.contents) continue
      const usedBytes = Math.min(node.usedBytes ?? node.contents.byteLength, node.contents.byteLength)
      const data = node.contents.subarray(0, usedBytes)
      outputs.push({ path, name: basename(path), type: outputType(path), data })
      if (data.buffer instanceof ArrayBuffer) transfers.push(data.buffer)
    }

    self.postMessage(
      { id: request.id, type: 'done', ok: true, result: { exitCode, logs, outputs } },
      [...new Set(transfers)],
    )
  } catch (error) {
    self.postMessage({
      id: request.id,
      type: 'done',
      ok: false,
      error: error instanceof Error ? error.stack || error.message : String(error),
    })
  }
}
