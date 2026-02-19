#!/usr/bin/env node
/**
 * Simple Server Dev Script
 * 
 * Just watches and rebuilds the server - no child process management.
 * Turbo handles orchestration, this script just focuses on the server.
 */

import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '../')

process.chdir(rootDir)

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
}

// Build configuration
const buildScript = `
import * as esbuild from 'esbuild'

const excludeTestsPlugin = {
  name: 'exclude-tests',
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (args.path.includes('__tests__') || 
          args.path.includes('/tests/') ||
          args.path.includes('.test.') ||
          args.path.includes('.spec.')) {
        return { path: args.path, external: true }
      }
    })
  }
}

await esbuild.build({
  entryPoints: ['src/index.ts'],
  outfile: 'build/index.js',
  platform: 'node',
  format: 'esm',
  bundle: true,
  treeShaking: true,
  minify: false,
  sourcemap: true,
  packages: 'external',
  external: ['vitest'],
  target: 'node22',
  define: {
    'process.env.CLIENT': 'false',
    'process.env.SERVER': 'true',
  },
  loader: {
    '.ts': 'ts',
    '.tsx': 'tsx',
  },
  plugins: [excludeTestsPlugin],
  logLevel: 'error',
})

console.log('✅ Server build complete')
`

// Initial build
console.log(`${colors.blue}Building server...${colors.reset}`)
await new Promise((resolve, reject) => {
  const proc = spawn('bun', ['-e', buildScript], {
    stdio: 'inherit',
    cwd: rootDir
  })
  proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`Build failed with code ${code}`)))
  proc.on('error', reject)
})

// Track server process
let serverProcess = null
let isRestarting = false
let shuttingDown = false

const hasProcessExited = (proc) =>
  proc.exitCode !== null || proc.signalCode !== null

async function stopServer(signal = 'SIGTERM') {
  if (!serverProcess) {
    serverProcess = null
    return
  }

  const proc = serverProcess
  if (hasProcessExited(proc)) {
    if (serverProcess === proc) {
      serverProcess = null
    }
    return
  }

  await new Promise((resolve) => {
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      resolve()
    }

    const timeout = setTimeout(() => {
      if (!hasProcessExited(proc)) {
        try {
          proc.kill('SIGKILL')
        } catch {}
      }
      done()
    }, 5000)

    proc.once('exit', () => {
      clearTimeout(timeout)
      done()
    })

    try {
      proc.kill(signal)
    } catch {
      clearTimeout(timeout)
      done()
    }
  })

  if (serverProcess === proc) {
    serverProcess = null
  }
}

// Start server
function startServer() {
  if (serverProcess && !hasProcessExited(serverProcess)) {
    console.log(`${colors.dim}Server already running (PID ${serverProcess.pid})${colors.reset}`)
    return
  }
  serverProcess = null

  console.log(`${colors.green}Starting server...${colors.reset}`)
  const proc = spawn('bun', ['--preload', './src/shared/polyfills.ts', 'build/index.js'], {
    stdio: 'inherit',
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: process.env.PORT || '5555',
      PUBLIC_WS_URL: process.env.PUBLIC_WS_URL || 'ws://localhost:5555/ws',
      PUBLIC_CDN_URL: process.env.PUBLIC_CDN_URL || 'http://localhost:8080',
    }
  })
  serverProcess = proc

  proc.on('exit', (code, signal) => {
    console.log(`${colors.yellow}Server exited (code: ${code}, signal: ${signal})${colors.reset}`)
    if (serverProcess === proc) {
      serverProcess = null
    }
    
    // Don't auto-restart on intentional shutdown
    if (!shuttingDown && signal !== 'SIGTERM' && signal !== 'SIGINT' && !isRestarting) {
      console.log(`${colors.red}Server crashed. Fix the error and save a file to rebuild.${colors.reset}`)
    }
  })

  proc.on('error', (err) => {
    console.error(`${colors.red}Server error:${colors.reset}`, err)
  })
}

// Start initial server
startServer()

// Setup file watcher
console.log(`${colors.blue}Setting up file watcher...${colors.reset}`)

const { default: chokidar } = await import('chokidar')

const watchRoots = [
  path.join(rootDir, 'src'),
  path.join(rootDir, '../shared/build'),
  // Fallback for environments where shared build output is delayed.
  path.join(rootDir, '../shared/src'),
]

const watchedExtensionRegex = /\.(ts|tsx|js|mjs|sql)$/
const pollFallbackMtimes = new Map()
let pollFallbackInterval = null

const isIgnoredPath = (filePath, stats) => {
  const normalized = filePath.replace(/\\/g, '/')

  if (normalized.includes('/node_modules/')) return true
  if (normalized.includes('/packages/server/build/')) return true
  if (normalized.includes('/packages/server/dist/')) return true
  if (/\.test\./.test(normalized) || /\.spec\./.test(normalized)) return true

  if (stats?.isDirectory?.()) return false
  return !watchedExtensionRegex.test(normalized)
}

async function collectWatchFiles(dirPath, out) {
  let entries
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (isIgnoredPath(fullPath, entry)) continue

    if (entry.isDirectory()) {
      await collectWatchFiles(fullPath, out)
    } else {
      out.push(fullPath)
    }
  }
}

async function listWatchFiles() {
  const files = []
  for (const root of watchRoots) {
    await collectWatchFiles(root, files)
  }
  return files
}

async function seedPollFallback() {
  const files = await listWatchFiles()
  pollFallbackMtimes.clear()
  for (const file of files) {
    try {
      const stat = await fs.stat(file)
      pollFallbackMtimes.set(file, stat.mtimeMs)
    } catch {}
  }
  return files.length
}

async function scanPollFallbackForChange() {
  const files = await listWatchFiles()
  const seen = new Set(files)
  let changedPath = null

  for (const file of files) {
    try {
      const stat = await fs.stat(file)
      const nextMtime = stat.mtimeMs
      const prevMtime = pollFallbackMtimes.get(file)
      if (prevMtime === undefined || nextMtime > prevMtime + 1) {
        pollFallbackMtimes.set(file, nextMtime)
        changedPath ||= file
      }
    } catch {}
  }

  for (const file of pollFallbackMtimes.keys()) {
    if (!seen.has(file)) {
      pollFallbackMtimes.delete(file)
      changedPath ||= file
    }
  }

  return { changedPath, fileCount: files.length }
}

async function startPollingFallback() {
  if (pollFallbackInterval) return
  const fileCount = await seedPollFallback()
  console.log(
    `${colors.yellow}↻ Falling back to polling watcher (${fileCount} files).${colors.reset}`,
  )

  pollFallbackInterval = setInterval(() => {
    if (isRestarting || shuttingDown) return
    void scanPollFallbackForChange().then(({ changedPath }) => {
      if (changedPath) {
        void rebuild(changedPath)
      }
    })
  }, 1000)
}

const watcher = chokidar.watch(watchRoots, {
  ignored: isIgnoredPath,
  usePolling: true,
  interval: 250,
  binaryInterval: 500,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 300,
    pollInterval: 100
  }
})

let rebuildTimeout = null

const rebuild = async (filePath) => {
  if (isRestarting) return
  
  clearTimeout(rebuildTimeout)
  rebuildTimeout = setTimeout(async () => {
    isRestarting = true
    
    const normalized = filePath.replace(/\\/g, '/')
    const shortPath = normalized.startsWith(rootDir.replace(/\\/g, '/'))
      ? path.relative(rootDir, filePath)
      : path.relative(path.join(rootDir, '..', '..'), filePath)
    console.log(`\n${colors.yellow}⚡ Change detected: ${shortPath}${colors.reset}`)
    console.log(`${colors.blue}Rebuilding server...${colors.reset}`)

    try {
      // Rebuild
      await new Promise((resolve, reject) => {
        const proc = spawn('bun', ['-e', buildScript], {
          stdio: 'inherit',
          cwd: rootDir
        })
        proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`Build failed`)))
        proc.on('error', reject)
      })

      console.log(`${colors.green}✓ Rebuild complete${colors.reset}`)
      console.log(`${colors.blue}Restarting server...${colors.reset}`)

      // Kill old server and wait for graceful shutdown to complete
      await stopServer('SIGTERM')

      // Start new server
      startServer()
      console.log(`${colors.green}✓ Server restarted${colors.reset}\n`)
    } catch (err) {
      console.error(`${colors.red}Rebuild failed:${colors.reset}`, err.message)
    } finally {
      isRestarting = false
    }
  }, 200)
}

watcher.on('change', rebuild)
watcher.on('add', rebuild)
watcher.on('ready', () => {
  const watched = watcher.getWatched()
  const fileCount = Object.values(watched).reduce((sum, files) => sum + files.length, 0)
  const dirCount = Object.keys(watched).length
  if (fileCount === 0) {
    console.log(`${colors.yellow}⚠ File watcher initialized but found 0 files. Watch roots:${colors.reset}`)
    for (const p of watchRoots) console.log(`${colors.dim}  - ${p}${colors.reset}`)
    void startPollingFallback()
  }
  console.log(`${colors.green}✓ Watching ${fileCount} files across ${dirCount} directories${colors.reset}`)
})

// Cleanup on exit
const cleanup = async () => {
  if (shuttingDown) return
  shuttingDown = true

  console.log(`\n${colors.yellow}Shutting down...${colors.reset}`)
  clearTimeout(rebuildTimeout)
  if (pollFallbackInterval) {
    clearInterval(pollFallbackInterval)
    pollFallbackInterval = null
  }
  await watcher.close()
  await stopServer('SIGTERM')
}

const shutdownAndExit = async (code = 0) => {
  try {
    await cleanup()
  } finally {
    process.exit(code)
  }
}

process.on('SIGINT', () => { void shutdownAndExit(0) })
process.on('SIGTERM', () => { void shutdownAndExit(0) })
process.on('SIGHUP', () => { void shutdownAndExit(0) })
process.on('disconnect', () => { void shutdownAndExit(0) })

process.on('uncaughtException', (err) => {
  console.error(`${colors.red}Uncaught exception:${colors.reset}`, err)
  void shutdownAndExit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error(`${colors.red}Unhandled rejection:${colors.reset}`, reason)
  void shutdownAndExit(1)
})

process.on('exit', () => {
  if (serverProcess && !serverProcess.killed) {
    try {
      serverProcess.kill('SIGTERM')
    } catch {}
  }
})

// Keep alive
await new Promise(() => {})
