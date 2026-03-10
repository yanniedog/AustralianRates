export {
  asArray,
  getText,
  isRecord,
  pickText,
  type JsonRecord,
} from './cdr/primitives.js'
export { productUrlFromDetail, publishedAtFromDetail } from './cdr/detail-metadata.js'
export { fetchCdrJson, fetchJson } from './cdr/http.js'
export { discoverProductsEndpoint, extractProducts, nextLink } from './cdr/discovery.js'
export { fetchProductDetailRows, fetchResidentialMortgageProductIds } from './cdr/mortgage-fetch.js'
export { backfillSeedProductRows, buildBackfillCursorKey, cdrCollectionNotes } from './cdr/backfill.js'
