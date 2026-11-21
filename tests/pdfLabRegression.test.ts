import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { extractClinicalDataFromText, extractPDFContent } from '../src/utils/pdfExtractor'

it('reads the synthetic lab PDF without inventing diagnoses', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/lab-report.pdf', import.meta.url)))
  const pdf = await extractPDFContent(bytes)
  const result = extractClinicalDataFromText(pdf.text, 'lab-report.pdf')
  expect(pdf.pageCount).toBe(1)
  expect(result.metrics.find(metric => metric.name === 'Creatinine')?.value).toBe(145)
  expect(result.metrics.find(metric => metric.name.includes('Glucose'))?.value).toBe(8.4)
  expect(result.metrics.find(metric => metric.name === 'HbA1c')?.value).toBe('7.8%')
  expect(result.diseases).toEqual([])
})

it('rejects corrupt PDFs instead of parsing arbitrary bytes as clinical text', async () => {
  const invalid = new TextEncoder().encode('%PDF-1.4\ncorrupt PDF, no clinical content')
  await expect(extractPDFContent(invalid)).rejects.toThrow()
})
