export {
  asArray,
  getText,
  isRecord,
  pickText,
  type JsonRecord,
} from './cdr/primitives'
export { productUrlFromDetail, publishedAtFromDetail } from './cdr/detail-metadata'
export { fetchCdrJson, fetchJson } from './cdr/http'
export { discoverProductsEndpoint, extractProducts, nextLink } from './cdr/discovery'
export { fetchProductDetailRows, fetchResidentialMortgageProductIds } from './cdr/mortgage-fetch'
export { backfillSeedProductRows, buildBackfillCursorKey, cdrCollectionNotes } from './cdr/backfill'
