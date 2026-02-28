import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const registryPath = path.join(root, 'docs', 'hard-limits-registry.json')
const jsonOutPath = path.join(root, 'docs', 'hard-limits-inventory.json')
const csvOutPath = path.join(root, 'docs', 'hard-limits-inventory.csv')

function csvEscape(value) {
  const raw = String(value ?? '')
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

async function main() {
  const registry = JSON.parse(await readFile(registryPath, 'utf8'))
  const inventory = registry.map((entry) => ({
    id: entry.id,
    component: entry.component,
    category: entry.category,
    scope: entry.scope,
    current_value: entry.current_value,
    unit: entry.unit,
    risk_class: entry.risk_class,
    replacement_behavior: entry.replacement_behavior,
    rationale: entry.rationale,
    source_file: entry.source_file,
  }))

  const headers = [
    'id',
    'component',
    'category',
    'scope',
    'current_value',
    'unit',
    'risk_class',
    'replacement_behavior',
    'rationale',
    'source_file',
  ]
  const csv = [
    headers.join(','),
    ...inventory.map((entry) => headers.map((header) => csvEscape(entry[header])).join(',')),
  ].join('\n')

  await writeFile(jsonOutPath, `${JSON.stringify(inventory, null, 2)}\n`)
  await writeFile(csvOutPath, `${csv}\n`)
  console.log(`Synced ${inventory.length} hard-limit entries.`)
}

await main()
