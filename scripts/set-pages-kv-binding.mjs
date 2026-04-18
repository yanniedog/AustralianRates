#!/usr/bin/env node
/**
 * Bind CHART_CACHE_KV to the Pages project's production environment.
 *
 * Pages Functions can only read KV namespaces that are explicitly bound to
 * the Pages project. The API Worker already binds the namespace
 * `f4df70d373d54e08af64efd2ec148551`; this script adds the same binding to
 * the `australianrates` Pages project so the `_middleware.js` can read
 * precomputed snapshots directly (bypassing the self-fetch loop).
 *
 * Run once per environment change:
 *   node scripts/set-pages-kv-binding.mjs
 */

import { readFileSync } from 'node:fs'

const ENV_PATH = '.env'
const PROJECT_NAME = 'australianrates'
const BINDING_NAME = 'CHART_CACHE_KV'
const KV_NAMESPACE_ID = 'f4df70d373d54e08af64efd2ec148551'

const TOKEN_KEYS = [
  'CLOUDFLARE_FULL_ACCESS_TOKEN',
  'CLOUDFLARE_PAGES_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_GENERAL_TOKEN',
  'CF_API_TOKEN',
  'CLOUDFLARE_MULTI',
]

function loadEnv() {
  const env = {}
  try {
    const body = readFileSync(ENV_PATH, 'utf8')
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const equals = line.indexOf('=')
      if (equals < 0) continue
      const key = line.slice(0, equals).trim()
      let value = line.slice(equals + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      env[key] = value
    }
  } catch (error) {
    console.warn('Could not read .env:', error.message)
  }
  return env
}

function pickToken(env) {
  for (const key of TOKEN_KEYS) {
    const value = env[key] || process.env[key]
    if (value && value.trim()) return { key, value: value.trim() }
  }
  return null
}

/** Default account id from tools/node-scripts/src/lib/cloudflare-token.ts. */
const DEFAULT_ACCOUNT_ID = 'f3250f7113cfd8c7f747a09f942ca6d0'

function pickAccountId(env) {
  return (
    env.CLOUDFLARE_ACCOUNT_ID ||
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    env.CF_ACCOUNT_ID ||
    process.env.CF_ACCOUNT_ID ||
    DEFAULT_ACCOUNT_ID
  )
}

async function cf(method, path, token, body) {
  const url = `https://api.cloudflare.com/client/v4${path}`
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch (_err) {
    throw new Error(`Non-JSON response from ${method} ${path}: ${text.slice(0, 200)}`)
  }
  if (!response.ok || json.success === false) {
    throw new Error(`${method} ${path} failed: ${JSON.stringify(json.errors ?? text.slice(0, 200))}`)
  }
  return json.result
}

async function main() {
  const env = loadEnv()
  const token = pickToken(env)
  const accountId = pickAccountId(env)
  if (!token) {
    console.error('No Cloudflare token found. Set one of:', TOKEN_KEYS.join(', '))
    process.exit(1)
  }
  if (!accountId) {
    console.error('CLOUDFLARE_ACCOUNT_ID not set in .env')
    process.exit(1)
  }

  console.log(`Using token from ${token.key}`)
  console.log(`Account: ${accountId}  Project: ${PROJECT_NAME}`)

  const project = await cf('GET', `/accounts/${accountId}/pages/projects/${PROJECT_NAME}`, token.value)
  const deploymentConfigs = project.deployment_configs ?? { production: {}, preview: {} }
  const production = deploymentConfigs.production ?? {}
  const kvNamespaces = { ...(production.kv_namespaces ?? {}) }
  if (kvNamespaces[BINDING_NAME] && kvNamespaces[BINDING_NAME].namespace_id === KV_NAMESPACE_ID) {
    console.log(`Binding ${BINDING_NAME} already present with correct namespace; nothing to do.`)
    return
  }
  kvNamespaces[BINDING_NAME] = { namespace_id: KV_NAMESPACE_ID }

  const patch = {
    deployment_configs: {
      ...deploymentConfigs,
      production: {
        ...production,
        kv_namespaces: kvNamespaces,
      },
    },
  }

  const result = await cf('PATCH', `/accounts/${accountId}/pages/projects/${PROJECT_NAME}`, token.value, patch)
  const applied = result?.deployment_configs?.production?.kv_namespaces?.[BINDING_NAME]
  if (applied && applied.namespace_id === KV_NAMESPACE_ID) {
    console.log(`Bound ${BINDING_NAME} -> ${KV_NAMESPACE_ID} on production environment.`)
    console.log('Trigger a new deployment for the binding to take effect.')
  } else {
    console.warn('PATCH response did not show the expected binding:', JSON.stringify(applied))
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
