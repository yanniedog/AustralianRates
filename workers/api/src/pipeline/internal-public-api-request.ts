import {
  API_BASE_PATH,
  ECONOMIC_API_BASE_PATH,
  SAVINGS_API_BASE_PATH,
  TD_API_BASE_PATH,
} from '../constants'
import { economicPublicRoutes } from '../routes/economic-public'
import { publicRoutes } from '../routes/public'
import { savingsPublicRoutes } from '../routes/savings-public'
import { tdPublicRoutes } from '../routes/td-public'
import type { EnvBindings } from '../types'

type RequestableApp = {
  request(input: string, init?: RequestInit, env?: EnvBindings): Response | Promise<Response>
}

type InternalPublicApiRoute = {
  basePath: string
  app: RequestableApp
}

const INTERNAL_PUBLIC_API_HOSTS = new Set([
  'www.australianrates.com',
  'australianrates.com',
])

const INTERNAL_PUBLIC_API_ROUTES: InternalPublicApiRoute[] = [
  { basePath: API_BASE_PATH, app: publicRoutes },
  { basePath: SAVINGS_API_BASE_PATH, app: savingsPublicRoutes },
  { basePath: TD_API_BASE_PATH, app: tdPublicRoutes },
  { basePath: ECONOMIC_API_BASE_PATH, app: economicPublicRoutes },
]

function matchInternalRoute(url: URL): InternalPublicApiRoute | null {
  if (!INTERNAL_PUBLIC_API_HOSTS.has(url.hostname)) return null
  for (const route of INTERNAL_PUBLIC_API_ROUTES) {
    if (url.pathname === route.basePath || url.pathname.startsWith(`${route.basePath}/`)) {
      return route
    }
  }
  return null
}

export function isInternalPublicApiUrl(input: string | URL): boolean {
  const url = input instanceof URL ? input : new URL(input)
  return matchInternalRoute(url) != null
}

export async function dispatchInternalPublicApiRequest(
  input: {
    url: string
    env: EnvBindings
    init?: RequestInit
  },
): Promise<Response | null> {
  const url = new URL(input.url)
  const route = matchInternalRoute(url)
  if (!route) return null

  const subpath = url.pathname.slice(route.basePath.length) || '/'
  const internalUrl = `https://internal.australianrates.test${subpath}${url.search}`
  return route.app.request(internalUrl, input.init, input.env)
}
