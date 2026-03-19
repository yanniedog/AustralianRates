import { asArray, getText, isRecord, type JsonRecord } from './primitives.js'

const POSITIVE_OFFSET_RE = /\boffset\b/i
const NEGATIVE_OFFSET_RE =
  /\b(?:no|without|not included|not available|unavailable|excluded|does not include|doesn't include)\s+offset\b/i

function booleanish(value: unknown): boolean | null {
  if (value === true || value === false) return value
  const text = getText(value).toLowerCase()
  if (!text) return null
  if (text === 'true' || text === 'yes' || text === '1' || text === 'available' || text === 'included') return true
  if (text === 'false' || text === 'no' || text === '0' || text === 'unavailable' || text === 'not_available') return false
  return null
}

function pushCandidateText(values: string[], value: unknown): void {
  const text = getText(value)
  if (text) values.push(text)
}

function scanFeatureLikeRecords(values: string[], nodes: unknown[]): void {
  for (const node of nodes) {
    if (!isRecord(node)) continue
    const candidateTexts = [
      node.name,
      node.featureType,
      node.featureName,
      node.additionalInfo,
      node.additionalValue,
      node.description,
      node.value,
    ]
      .map((value) => getText(value))
      .filter(Boolean)
    values.push(...candidateTexts)

    const directOffsetFlag = [node.offset, node.offsetAccount, node.hasOffset, node.hasOffsetAccount, node.linkedOffsetAccount]
      .map(booleanish)
      .find((value) => value != null)
    if (directOffsetFlag != null) {
      values.push(directOffsetFlag ? 'offset available' : 'offset unavailable')
      continue
    }

    const genericAvailabilityFlag = [node.available, node.isAvailable].map(booleanish).find((value) => value != null)
    if (genericAvailabilityFlag != null && candidateTexts.some((text) => POSITIVE_OFFSET_RE.test(text) || NEGATIVE_OFFSET_RE.test(text))) {
      values.push(genericAvailabilityFlag ? 'offset available' : 'offset unavailable')
    }
  }
}

export function detectExplicitOffsetAccountValue(detail: JsonRecord, rate?: JsonRecord): boolean | null {
  const directFlags = [
    detail.offset,
    detail.offsetAccount,
    detail.hasOffset,
    detail.hasOffsetAccount,
    detail.linkedOffsetAccount,
    rate?.offset,
    rate?.offsetAccount,
    rate?.hasOffset,
    rate?.hasOffsetAccount,
  ]
    .map(booleanish)
    .find((value) => value != null)
  if (directFlags != null) return directFlags

  const candidates: string[] = []
  pushCandidateText(candidates, detail.additionalInfo)
  pushCandidateText(candidates, detail.additionalValue)
  pushCandidateText(candidates, detail.description)
  pushCandidateText(candidates, rate?.additionalInfo)
  pushCandidateText(candidates, rate?.additionalValue)
  pushCandidateText(candidates, rate?.name)

  scanFeatureLikeRecords(candidates, asArray(detail.features))
  scanFeatureLikeRecords(candidates, asArray(detail.featureSet))
  scanFeatureLikeRecords(candidates, asArray(detail.featureBundles))
  scanFeatureLikeRecords(candidates, asArray(detail.bundles))
  scanFeatureLikeRecords(candidates, asArray(rate?.features))
  scanFeatureLikeRecords(candidates, asArray(rate?.benefits))

  for (const candidate of candidates) {
    if (NEGATIVE_OFFSET_RE.test(candidate)) return false
  }
  for (const candidate of candidates) {
    if (POSITIVE_OFFSET_RE.test(candidate)) return true
  }

  return null
}
