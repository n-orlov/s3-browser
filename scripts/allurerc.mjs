// Allure 3 configuration for the merged unit + e2e report (used by the `report` job in .github/workflows/ci.yml).
// History lives inside the report directory as `history.jsonl`: the job copies the previous one from the
// `gh-pages` branch in before `allure generate`, Allure appends this run to it, and the publish job pushes the
// whole directory back, so the trend widgets keep their data from run to run.
export default {
  name: 'S3 Browser',
  output: './allure-report',
  historyPath: './allure-report/history.jsonl',
  appendHistory: true,
  historyLimit: 50,
};
