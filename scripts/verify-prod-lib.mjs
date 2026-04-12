import path from 'node:path'

const IGNORED_PREFIXES = [
  '.claude/',
  '.cursor/',
  'artifacts/',
  'docs/',
  'logs/',
  'test-screenshots/',
]

const SITE_PATTERNS = [
  /^site\//,
  /^prototypes\/lightweight-charts\//,
  /^scripts\/build-lightweight-vendor\.mjs$/,
  /^scripts\/check-public-assets\.js$/,
  /^scripts\/check-clarity-installation\.js$/,
  /^write-deploy-version\.js$/,
  /^tools\/node-scripts\/src\/write-deploy-version\.ts$/,
  /^tools\/node-scripts\/src\/scripts\/check-public-assets\.ts$/,
  /^tools\/node-scripts\/src\/scripts\/check-clarity-installation\.ts$/,
]

const API_PATTERNS = [
  /^workers\/api\//,
  /^packages\/shared\//,
]

const ARCHIVE_PATTERNS = [
  /^workers\/archive\//,
]

const FULL_PATTERNS = [
  /^\.github\/workflows\//,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^[^/]+\.config\.[^.]+$/,
  /^[^/]+\.json$/,
  /^[^/]+\.(?:js|mjs|cjs|ts)$/,
  /^[^/]+\/package\.json$/,
  /^[^/]+\/tsconfig[^/]*\.json$/,
  /^[^/]+\/vitest[^/]*\.config\.[^.]+$/,
  /^scripts\//,
  /^tools\/node-scripts\//,
]

function normalizeFile(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\/+/, '')
}

function matchesAny(file, patterns) {
  return patterns.some((pattern) => pattern.test(file))
}

export function isIgnoredChange(file) {
  const normalized = normalizeFile(file)
  if (!normalized) return true
  if (normalized.endsWith('.md')) return true
  return IGNORED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

export function resolveAutoScope(files) {
  const normalized = [...new Set((files || []).map(normalizeFile).filter(Boolean))]
  const relevant = normalized.filter((file) => !isIgnoredChange(file))

  if (normalized.length > 0 && relevant.length === 0) {
    return {
      scopes: [],
      relevantFiles: [],
      skipped: true,
      reason: 'docs_or_meta_only',
    }
  }

  const scopes = new Set()
  for (const file of relevant) {
    if (matchesAny(file, FULL_PATTERNS)) {
      scopes.add('full')
      break
    }
    if (matchesAny(file, SITE_PATTERNS)) scopes.add('site')
    if (matchesAny(file, API_PATTERNS)) scopes.add('api')
    if (matchesAny(file, ARCHIVE_PATTERNS)) scopes.add('archive')
  }

  if (scopes.size === 0) {
    return {
      scopes: ['full'],
      relevantFiles: relevant,
      skipped: false,
      reason: relevant.length === 0 ? 'no_diff_fallback' : 'unknown_surface_fallback',
    }
  }

  if (scopes.has('full')) {
    return {
      scopes: ['full'],
      relevantFiles: relevant,
      skipped: false,
      reason: 'verification_or_shared_change',
    }
  }

  const orderedScopes = ['site', 'api', 'archive'].filter((scope) => scopes.has(scope))
  return {
    scopes: orderedScopes,
    relevantFiles: relevant,
    skipped: false,
    reason: 'scoped_from_changes',
  }
}

export function buildVerifyPlan({ scope = 'auto', depth = 'smoke', files = [] } = {}) {
  const mode = depth === 'full' ? 'full' : 'smoke'
  const auto = scope === 'auto' ? resolveAutoScope(files) : null
  const scopes = auto ? auto.scopes : [scope]

  if (auto?.skipped) {
    return {
      scope,
      depth: mode,
      scopes: [],
      commands: [],
      skipped: true,
      reason: auto.reason,
      relevantFiles: auto.relevantFiles,
    }
  }

  const commandMap = {
    smoke: {
      site: [
        { label: 'Pages smoke', command: 'npm run diagnose:pages' },
        { label: 'Homepage smoke', command: 'npm run test:homepage' },
      ],
      api: [
        { label: 'API worker tests', command: 'npm run test:api' },
        { label: 'API production smoke', command: 'npm run diagnose:api:smoke' },
      ],
      archive: [
        { label: 'Archive worker tests', command: 'npm run test:archive' },
      ],
      full: [
        { label: 'API worker tests', command: 'npm run test:api' },
        { label: 'Archive worker tests', command: 'npm run test:archive' },
        { label: 'API production smoke', command: 'npm run diagnose:api:smoke' },
        { label: 'Pages smoke', command: 'npm run diagnose:pages' },
        { label: 'Homepage smoke', command: 'npm run test:homepage' },
      ],
    },
    full: {
      site: [
        { label: 'Pages smoke', command: 'npm run diagnose:pages' },
        { label: 'Homepage full', command: 'npm run test:homepage:full' },
        { label: 'Production hosting verify', command: 'npm run verify:prod-hosting' },
      ],
      api: [
        { label: 'API worker tests', command: 'npm run test:api' },
        { label: 'API deep diagnostics', command: 'npm run diagnose:api' },
      ],
      archive: [
        { label: 'Archive worker tests', command: 'npm run test:archive' },
      ],
      full: [
        { label: 'API worker tests', command: 'npm run test:api' },
        { label: 'Archive worker tests', command: 'npm run test:archive' },
        { label: 'API deep diagnostics', command: 'npm run diagnose:api' },
        { label: 'Pages smoke', command: 'npm run diagnose:pages' },
        { label: 'Homepage full', command: 'npm run test:homepage:full' },
        { label: 'Production hosting verify', command: 'npm run verify:prod-hosting' },
      ],
    },
  }

  const deduped = []
  const seen = new Set()
  for (const activeScope of scopes) {
    const entries = commandMap[mode][activeScope] || []
    for (const entry of entries) {
      if (seen.has(entry.command)) continue
      seen.add(entry.command)
      deduped.push(entry)
    }
  }

  return {
    scope,
    depth: mode,
    scopes,
    commands: deduped,
    skipped: false,
    reason: auto?.reason || 'explicit_scope',
    relevantFiles: auto?.relevantFiles || [],
  }
}

export function parseVerifyArgs(argv) {
  const out = { scope: 'auto', depth: 'smoke' }
  for (const raw of argv || []) {
    const arg = String(raw || '').trim()
    if (arg.startsWith('--scope=')) out.scope = arg.slice('--scope='.length)
    if (arg.startsWith('--depth=')) out.depth = arg.slice('--depth='.length)
  }
  return out
}

export function collectAutoScopeFiles({ cwd, execSyncImpl }) {
  const execSync = execSyncImpl
  const attempts = [
    ['git', ['diff', '--name-only', '--cached']],
    ['git', ['diff', '--name-only']],
    ['git', ['show', '--pretty=', '--name-only', 'HEAD']],
  ]

  const files = []
  for (const [command, args] of attempts) {
    try {
      const output = execSync([command, ...args].join(' '), {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      for (const line of String(output || '').split(/\r?\n/)) {
        const normalized = normalizeFile(line)
        if (normalized) files.push(normalized)
      }
      if (files.length > 0) break
    } catch {
      // Fall through to the next source.
    }
  }

  return [...new Set(files)]
}

export function formatPlan(plan) {
  if (plan.skipped) {
    return `verify:prod skipped (${plan.reason.replace(/_/g, ' ')})`
  }
  const scopes = plan.scopes.join(', ') || '(none)'
  return `verify:prod scope=${scopes} depth=${plan.depth}`
}

export function repoRelativeFile(file) {
  return normalizeFile(path.relative(process.cwd(), file))
}
