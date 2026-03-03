import { runBackfillCdrDetailHash } from './backfill-cdr-detail-hash'

function ensureDefault(args: string[], flag: string, value?: string): string[] {
  const hasFlag = args.some((arg, index) => {
    if (arg === flag) return true
    if (arg.startsWith(`${flag}=`)) return true
    if (value && arg === value && index > 0 && args[index - 1] === flag) return true
    return false
  })

  if (hasFlag) return args
  return value ? [flag, value, ...args] : [flag, ...args]
}

export function runBackfillCdrDetailHashProd(args: string[]): number {
  let out = [...args]
  out = ensureDefault(out, '--db', 'australianrates_api')
  out = ensureDefault(out, '--remote')
  return runBackfillCdrDetailHash(out)
}

export function main(args: string[]): void {
  try {
    process.exitCode = runBackfillCdrDetailHashProd(args)
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`)
    process.exitCode = 1
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2))
}
