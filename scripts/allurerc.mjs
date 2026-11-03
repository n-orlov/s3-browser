// Allure 3 configuration for the merged unit + e2e report (generated in the Jenkinsfile's post { always } block).
// History lives inside the report directory as `history.jsonl`: the build copies the previous one from the last
// build's archived `allure-history/` in before `allure generate`, Allure appends this run to it and the build archives
// it again, so the trend widgets keep their data from run to run.
export default {
  name: 'S3 Browser',
  output: './allure-report',
  historyPath: './allure-report/history.jsonl',
  appendHistory: true,
  historyLimit: 50,
};
