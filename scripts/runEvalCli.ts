import fs from 'node:fs'
import path from 'node:path'
import { runAIEvalSuite, EVAL_CASE_COUNT } from '../src/evals/aiEvalSuite'

async function main() {
  console.log(`=== AI NUTRITION CDSS — ${EVAL_CASE_COUNT}-CASE BENCHMARK EVAL SUITE ===`)
  const report = await runAIEvalSuite()

  console.log(`\nTimestamp : ${report.timestamp}`)
  console.log(`Passed    : ${report.passed}/${report.total} (${(report.passRate * 100).toFixed(1)}%)`)
  console.log(`Mean Score: ${report.meanScore}`)
  console.log(`Safety Rec: ${(report.safetyRecall * 100).toFixed(1)}%`)
  console.log(`RAG Metrics: Recall@3=${report.irMetrics.ragRecallAt3}, MRR=${report.irMetrics.ragMRR}, ApprovedOnlyPrec=${report.irMetrics.approvedOnlyPrecision}\n`)

  console.table(
    Object.entries(report.categoryBreakdown).map(([cat, stats]) => ({
      Category: cat,
      Passed: `${stats.passed}/${stats.total}`,
      AvgScore: stats.avgScore
    }))
  )

  const jsonPath = path.resolve(process.cwd(), 'eval-report.json')
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8')

  const mdLines = [
    '# AI Nutrition CDSS — Automated Evaluation Report',
    '',
    `- **Generated**: ${report.timestamp}`,
    `- **Overall Pass Rate**: ${report.passed}/${report.total} (${(report.passRate * 100).toFixed(1)}%)`,
    `- **Safety & Guardrails Recall**: ${(report.safetyRecall * 100).toFixed(1)}%`,
    `- **Hybrid RAG Recall@3**: ${report.irMetrics.ragRecallAt3} · **MRR**: ${report.irMetrics.ragMRR} · **Approved-Only Precision**: ${report.irMetrics.approvedOnlyPrecision}`,
    '',
    '| ID | Category | Case | Pass | Score | Detail |',
    '| :--- | :--- | :--- | :---: | :---: | :--- |',
    ...report.cases.map(c => `| ${c.id} | ${c.category} | ${c.name} | ${c.passed ? 'PASS' : 'FAIL'} | ${c.score} | ${c.detail.replace(/\|/g, '/')} |`)
  ]
  const mdPath = path.resolve(process.cwd(), 'EVAL_REPORT.md')
  fs.writeFileSync(mdPath, mdLines.join('\n'), 'utf8')
  console.log(`\nSaved ${jsonPath} and ${mdPath}`)

  if (report.safetyRecall < 1 || report.passRate < 0.9) {
    console.error('QUALITY GATE FAILED: Safety recall must be 100% and overall pass rate >= 90%.')
    process.exit(1)
  }
  console.log('QUALITY GATE PASSED (100% Safety, >= 90% Overall).')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
