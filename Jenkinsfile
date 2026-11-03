// s3-browser CI on the homelab Jenkins: multibranch job s3-browser/ci (see SPEC.md section 5).
//
// Quality runs on an arm64 phone agent. The phones are musl hosts, so every Node
// command runs in a glibc node:22 container with a memory cap; only Trivy (it drives
// the docker daemon itself) runs on the agent. The workspace persists between builds,
// so each stage starts from `git clean -ffdxq`.
//
// Shared library: github.com/n-orlov/jenkins-library (notifyTelegram and friends).
@Library('homelab') _

// One Node command in a throwaway node:22 container with the workspace mounted. Memory is
// capped (the phones are 6-8 GB and run other work); the npm cache lives on the agent so a
// build does not re-download 900 packages. Container name per build: a stage timeout that
// kills the shell can then be cleaned up by name.
def nodeSh(String cmd) {
  withEnv(["S3B_CMD=${cmd}"]) {
    sh '''
      cache="${S3B_NPM_CACHE:-$HOME/.cache/s3b-npm}"
      mkdir -p "$cache"
      name="s3b-quality-$(printf %s "$BUILD_TAG" | tr -c 'A-Za-z0-9_.-' '-')"
      docker run --rm --name "$name" --memory 3g --memory-swap 3g \
        --user "$(id -u):$(id -g)" -v "$PWD:/app" -v "$cache:/npm-cache" -w /app \
        -e HOME=/tmp/home -e npm_config_cache=/npm-cache -e CI=1 -e S3B_CMD \
        node:22 sh -c 'mkdir -p "$HOME" && git config --global --add safe.directory /app && eval "$S3B_CMD"'
    '''
  }
}

// The nightly lane: a build started by the cron trigger, or by hand with EXTENDED ticked. The lane's own stages and
// the Telegram message's sound condition both ask this one question.
def isNightly() {
  return currentBuild.getBuildCauses('hudson.triggers.TimerTrigger$TimerTriggerCause').size() > 0 || params.EXTENDED == true
}

// Paths that can change the packaged app, as shell `case` patterns (`*` also matches `/`). The packaging inputs and
// the release definition files; a change to any of them makes the Release dry-run stage run; `master` runs it unconditionally.
def releasePaths() {
  return [
    'package.json',
    'build/**',
    'electron-builder*',
    'Jenkinsfile.release',
    'ci/release-build.sh',
    'ci/release-stage.sh',
    'vite.config.*',
    'tsconfig*.json',
  ]
}

// 'true' when the change against origin/master touches a packaging path. POSIX sh only: the phone agents have no bash.
// Run in Quality (which has the checkout and the fetched origin/master) so the Release dry-run stage can decide in
// `when` before it takes an amd64 executor.
def packagingChanged() {
  withEnv(["S3B_RELEASE_PATHS=${releasePaths().join(' ')}"]) {
    return sh(returnStdout: true, script: '''
      set -f
      git diff --name-only origin/master...HEAD | while IFS= read -r file; do
        for pattern in $S3B_RELEASE_PATHS; do
          case "$file" in $pattern) echo true; exit 0 ;; esac
        done
      done | head -n 1
    ''').trim() == 'true' ? 'true' : 'false'
  }
}

// The sha a status belongs to: the revision Jenkins selected for this build (the PR head for a PR build, the branch
// revision otherwise). ci/gate-sha.sh resolves it from the HEAD reflog of this checkout, never from the fetched PR ref
// (which moves when the PR is pushed again before the checkout) or from the commit's shape: when the last entry that
// moved HEAD is Jenkins' target merge it is the commit that merge started from (the pinned head), otherwise HEAD, so a
// PR head that is itself a merge commit is never replaced by its first parent.
def gateSha() {
  return sh(returnStdout: true, script: 'sh ci/gate-sha.sh').trim()
}

// Names the stage a failure post reports. Every stage calls it first.
def gateStage(String name) {
  env.GATE_STAGE = name
}

// Posts the custom commit status jenkins/gate (the required check) on the PR head. The token is
// only ever read inside withCredentials. The description is stripped to a safe alphabet because it
// is spliced into a JSON body by the shell.
def postGate(String state, String desc) {
  String safe = desc.replaceAll('[^A-Za-z0-9 :._/-]', '').take(140)
  withCredentials([usernamePassword(credentialsId: 'github-n-orlov', usernameVariable: 'GH_USER', passwordVariable: 'GH_TOKEN')]) {
    withEnv(["GATE_STATE=${state}", "GATE_DESC=${safe}"]) {
      sh '''
        curl -fsS -o /dev/null -X POST \
          -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
          "https://api.github.com/repos/n-orlov/s3-browser/statuses/$GATE_SHA" \
          -d "{\\"state\\":\\"$GATE_STATE\\",\\"context\\":\\"jenkins/gate\\",\\"description\\":\\"$GATE_DESC\\",\\"target_url\\":\\"${BUILD_URL}\\"}"
      '''
    }
  }
}

// The final status, from post (the pipeline agent is none, so it takes a node; a build that never
// reached a checkout takes one here).
def finishGate(String state, String desc) {
  node('arm64 && docker && s3-browser') {
    if (!env.GATE_SHA) {
      checkout scm
      env.GATE_SHA = gateSha()
    }
    postGate(state, desc)
  }
}

// The release candidate of a green master build: which job, which build number, which sha. s3-browser/release copies
// it (copyArtifacts, lastSuccessful or CI_BUILD) and releases that sha, never master's tip. Only post { success } of a
// master build calls it. The pipeline agent is none, so it takes a node; the sha is the one the gate status names.
def archiveReleaseCandidate() {
  node('arm64 && docker && s3-browser') {
    if (!env.GATE_SHA) {
      checkout scm
      env.GATE_SHA = gateSha()
    }
    writeFile file: 'release-candidate.json',
              text: "{\"job\": \"${env.JOB_NAME}\", \"build\": ${env.BUILD_NUMBER}, \"sha\": \"${env.GATE_SHA}\"}\n"
    archiveArtifacts artifacts: 'release-candidate.json', fingerprint: true
  }
}

// One e2e shard of three, on an arm64 phone of its own. The phones are small (delta 2 executors / 7.5 GB,
// hotel 8 GB, bravo 6 GB) and a shard wants ~3 GB for Playwright plus 1 GB for LocalStack, so the lock admits
// one shard per agent at a time. Waiting for that lock on a node would hold an executor and serialise two
// shards on the same phone (delta has two executors), so a shard that finds its node's lock taken gives the
// executor back and asks again for a node other than the ones it was refused on. The node a shard ran on is
// kept in E2E_NODE_<i> for its cleanup. The run id scripts/e2e-docker.sh puts in its container names is
// derived from BUILD_TAG the same way e2eShardCleanup does.
def e2eShard(int index) {
  gateStage('E2E')
  String exclude = ''
  boolean ran = false
  for (int attempt = 0; attempt < 4 && !ran; attempt++) {
    node("arm64 && docker && s3-browser${exclude}") {
      lock(resource: "s3b-e2e-${env.NODE_NAME}", skipIfLocked: true) {
        ran = true
        env."E2E_NODE_${index}" = env.NODE_NAME
        checkout scm
        sh 'git clean -ffdxq'
        try {
          sh "CI=1 scripts/e2e-docker.sh --shard=${index}/3"
        } finally {
          // On every outcome: the pipeline's post { always } builds the reports from these.
          stash name: "e2e-results-${index}", allowEmpty: true,
                includes: 'junit/**, allure-results/**, playwright-report/**, test-results/results.json'
        }
      }
      if (!ran) {
        exclude += " && !${env.NODE_NAME}"
      }
    }
  }
  if (!ran) {
    error "E2E shard ${index}/3 found no free arm64 phone"
  }
}

// One soak shard of three: the e2e suite with every test repeated three times (`--repeat-each=3`), on an arm64 phone of its own under the same per-node lock and node-refusal loop as e2eShard. Retries stay 0,
// so a test that fails in even one repeat fails the shard. Whatever the outcome, the
// shard's results are stashed for the pipeline's post { always }, which runs ci/mark-flaky.mjs over all three shards'
// JSON reports at once (--shard spreads the repeats of a test over the shards, so one shard's report cannot show a
// fail-then-pass test). The node is kept in
// E2E_NODE_<i>, which e2eShardCleanup(i) reads, so the soak stage's post removes its containers like the E2E stage's.
def soakShard(int index) {
  gateStage('Soak')
  String exclude = ''
  boolean ran = false
  for (int attempt = 0; attempt < 4 && !ran; attempt++) {
    node("arm64 && docker && s3-browser${exclude}") {
      lock(resource: "s3b-e2e-${env.NODE_NAME}", skipIfLocked: true) {
        ran = true
        env."E2E_NODE_${index}" = env.NODE_NAME
        checkout scm
        sh 'git clean -ffdxq'
        try {
          sh "CI=1 scripts/e2e-docker.sh --repeat-each=3 --shard=${index}/3"
        } finally {
          stash name: "soak-results-${index}", allowEmpty: true,
                includes: 'junit/**, test-results/results.json'
        }
      }
      if (!ran) {
        exclude += " && !${env.NODE_NAME}"
      }
    }
  }
  if (!ran) {
    error "Soak shard ${index}/3 found no free arm64 phone"
  }
}

// Removes what a shard left behind when it was aborted or its script could not run its own trap, on the
// node the shard ran on: the shard's s3b- containers (with their anonymous volumes), any named volume they
// mounted and its network.
def e2eShardCleanup(int index) {
  String nodeName = env."E2E_NODE_${index}"
  if (!nodeName) {
    return
  }
  node(nodeName) {
    withEnv(["S3B_SHARD=${index}"]) {
      sh '''
        tag="$(printf %s "$BUILD_TAG" | tr -c 'A-Za-z0-9_.-' '-')-shard${S3B_SHARD}-"
        ids="$(docker ps -aq --filter "name=s3b-.*-${tag}" || true)"
        vols=""
        for id in $ids; do
          vols="$vols $(docker inspect -f '{{range .Mounts}}{{.Name}} {{end}}' "$id" 2>/dev/null || true)"
        done
        if [ -n "$ids" ]; then docker rm -fv $ids >/dev/null 2>&1 || true; fi
        if [ -n "$(echo $vols)" ]; then docker volume rm $vols >/dev/null 2>&1 || true; fi
        nets="$(docker network ls -q --filter "name=s3b-e2e-${tag}" || true)"
        if [ -n "$nets" ]; then docker network rm $nets >/dev/null 2>&1 || true; fi
      '''
    }
  }
}

pipeline {
  // Each stage names its own agent: a build must not hold a phone while another stage runs elsewhere.
  agent none

  options {
    ansiColor('xterm')
    timestamps()
    buildDiscarder(logRotator(numToKeepStr: '30'))
    disableConcurrentBuilds()
    timeout(time: 200, unit: 'MINUTES')   // ceiling; stages carry their own
    // s3-browser/release reads release-candidate.json; this job's own next build
    // reads the Allure history (patterns match the copier's absolute name).
    copyArtifactPermission('/s3-browser/release,/s3-browser/ci/*')
  }

  // On demand the nightly lane (Soak, Stability, Trivy fresh DB and, with it, Mutation) runs on any branch or PR.
  parameters {
    booleanParam(name: 'EXTENDED', defaultValue: false,
                 description: 'Extended CI: e2e soak (3 repeats), three clean-state unit runs, Trivy with a fresh DB, Stryker mutation')
  }

  // The nightly cron exists on master only; every other branch gets an empty spec (no trigger).
  triggers {
    cron(env.BRANCH_NAME == 'master' ? '17 2 * * *' : '')
  }

  stages {
    stage('Quality') {
      agent { label 'arm64 && docker && s3-browser' }
      // 20 minutes is the original quality job's bound; it is never raised (repocheckCiLane asserts it).
      options { timeout(time: 20, unit: 'MINUTES') }
      steps {
        script {
          gateStage('Quality')
          env.GATE_SHA = gateSha()
        }
        postGate('pending', 'Build running')
        // The workspace persists between builds: start from the checkout alone.
        sh 'git clean -ffdxq'
        // ratchet:check compares against the merge base with origin/master, which a PR
        // merge checkout may not carry as a ref.
        sh 'git fetch --no-tags origin +refs/heads/master:refs/remotes/origin/master'
        script { env.PACKAGING_CHANGED = packagingChanged() }
        // ISO weekday of the build in UTC (1 = Monday): the Mutation stage's weekly guard reads it in `when`.
        script { env.BUILD_DAY = sh(returnStdout: true, script: 'date -u +%u').trim() }
        nodeSh('npm ci --no-audit --no-fund')
        nodeSh('npm run typecheck')
        // The ESLint JSON report is written first (a red lint still leaves it) and archived by post { always }.
        nodeSh('npm run lint:report || true')
        nodeSh('npm run lint')
        nodeSh('npm run test:coverage')
        nodeSh('npm run crap')
        nodeSh('npm run ratchet:check')
        nodeSh('npm run audit:prod')
        sh 'ci/trivy.sh'
        nodeSh('npm run build')
        nodeSh('npm run sbom')
      }
      // Whatever the stage produced, red or green, goes to the reports in the pipeline's post { always }.
      post {
        always {
          stash name: 'quality-results', allowEmpty: true,
                includes: 'junit/**, coverage/**, allure-results-unit/**, reports/**, sbom/**'
        }
      }
    }

    // Three shards of the Playwright suite, one per phone (e2eShard takes the node and the per-node lock).
    stage('E2E') {
      parallel {
        stage('E2E shard 1/3') {
          options { timeout(time: 20, unit: 'MINUTES') }
          steps {
            script { e2eShard(1) }
          }
          post {
            aborted {
              script { e2eShardCleanup(1) }
            }
            cleanup {
              script { e2eShardCleanup(1) }
            }
          }
        }
        stage('E2E shard 2/3') {
          options { timeout(time: 20, unit: 'MINUTES') }
          steps {
            script { e2eShard(2) }
          }
          post {
            aborted {
              script { e2eShardCleanup(2) }
            }
            cleanup {
              script { e2eShardCleanup(2) }
            }
          }
        }
        stage('E2E shard 3/3') {
          options { timeout(time: 20, unit: 'MINUTES') }
          steps {
            script { e2eShard(3) }
          }
          post {
            aborted {
              script { e2eShardCleanup(3) }
            }
            cleanup {
              script { e2eShardCleanup(3) }
            }
          }
        }
      }
    }

    // Builds the x64 AppImage and smoke-tests it headless, on the amd64 agent: the phones are arm64 and the smoke test
    // cannot run an x64 binary there. Runs on master always, elsewhere only when the change touches a packaging path
    // (PACKAGING_CHANGED, set in Quality); `beforeAgent` decides before an executor is taken. Never publishes.
    stage('Release dry-run') {
      when {
        beforeAgent true
        anyOf {
          branch 'master'
          expression { env.PACKAGING_CHANGED == 'true' }
        }
      }
      agent { label 'amd64 && docker && s3-browser' }
      options { timeout(time: 20, unit: 'MINUTES') }
      steps {
        script { gateStage('Release dry-run') }
        sh 'git clean -ffdxq'
        nodeSh('npm ci --no-audit --no-fund')
        nodeSh('npm run build')
        // --x64 is explicit so the build does not depend on the agent's architecture. The Electron and
        // electron-builder downloads go to the agent's npm cache directory instead of the throwaway container.
        nodeSh('ELECTRON_CACHE=/npm-cache/electron ELECTRON_BUILDER_CACHE=/npm-cache/electron-builder npx electron-builder --linux AppImage --x64 -p never')
        sh 'S3B_SMOKE_DOCKER_ARGS="--memory 3g" scripts/smoke-appimage.sh'
      }
    }

    // The nightly lane (isNightly(): the cron on master, or EXTENDED ticked), arm64 phones only. Soak is the e2e suite with
    // every test repeated three times, in three shards on distinct phones under the per-node lock (soakShard).
    stage('Soak') {
      when { expression { isNightly() } }
      parallel {
        stage('Soak shard 1/3') {
          options { timeout(time: 60, unit: 'MINUTES') }
          steps {
            script { soakShard(1) }
          }
          post {
            aborted {
              script { e2eShardCleanup(1) }
            }
            cleanup {
              script { e2eShardCleanup(1) }
            }
          }
        }
        stage('Soak shard 2/3') {
          options { timeout(time: 60, unit: 'MINUTES') }
          steps {
            script { soakShard(2) }
          }
          post {
            aborted {
              script { e2eShardCleanup(2) }
            }
            cleanup {
              script { e2eShardCleanup(2) }
            }
          }
        }
        stage('Soak shard 3/3') {
          options { timeout(time: 60, unit: 'MINUTES') }
          steps {
            script { soakShard(3) }
          }
          post {
            aborted {
              script { e2eShardCleanup(3) }
            }
            cleanup {
              script { e2eShardCleanup(3) }
            }
          }
        }
      }
    }

    // Three unit runs, each from a clean state (git clean, then npm ci), retries still 0. A run that fails does not stop the
    // others: every run's JSON report is kept, ci/mark-flaky.mjs marks the fail-then-pass tests in the last run's JUnit and
    // writes the flaky count, and only then does the stage fail if any run failed (a flaky test is marked, never hidden).
    stage('Stability') {
      when {
        beforeAgent true
        expression { isNightly() }
      }
      agent { label 'arm64 && docker && s3-browser' }
      options { timeout(time: 45, unit: 'MINUTES') }
      steps {
        script {
          gateStage('Stability')
          sh 'git clean -ffdxq && mkdir stability-out'
          for (int run = 1; run <= 3; run++) {
            sh 'git clean -ffdxq -e stability-out'
            nodeSh('npm ci --no-audit --no-fund')
            nodeSh("npx vitest run || touch stability-out/failed; cp junit/vitest-results.json stability-out/run-${run}.json && cp junit/junit.xml stability-out/junit-${run}.xml")
          }
          nodeSh('mkdir -p reports && cp stability-out/junit-3.xml reports/stability-junit.xml && node ci/mark-flaky.mjs --junit reports/stability-junit.xml --count-file reports/flaky-count-stability.txt stability-out/run-1.json stability-out/run-2.json stability-out/run-3.json')
          if (fileExists('stability-out/failed')) {
            error 'A stability run failed (retries are 0): see the marked JUnit and the flaky count'
          }
        }
      }
      post {
        always {
          stash name: 'stability-results', allowEmpty: true, includes: 'reports/**, stability-out/**'
        }
      }
    }

    // Trivy with a freshly downloaded vulnerability DB (ci/trivy.sh --fresh drops the agent's cached DB first); the same
    // blocking gate as Quality's.
    stage('Trivy fresh DB') {
      when {
        beforeAgent true
        expression { isNightly() }
      }
      agent { label 'arm64 && docker && s3-browser' }
      options { timeout(time: 20, unit: 'MINUTES') }
      steps {
        script { gateStage('Trivy fresh DB') }
        sh 'git clean -ffdxq'
        sh 'TRIVY_REPORT=reports/trivy-fresh.txt ci/trivy.sh --fresh'
      }
      post {
        always {
          stash name: 'trivy-fresh-results', allowEmpty: true, includes: 'reports/trivy-fresh.txt'
        }
      }
    }

    // Stryker over the eight-module set of stryker.config.mjs (SPEC section 4), weekly: only in the nightly lane
    // (isNightly()) and only when the build day is Monday (BUILD_DAY, set in Quality) or EXTENDED is ticked.
    // `beforeAgent` decides before an executor is taken. `npm run mutation` runs in the memory-capped node:22
    // container (nodeSh), fails the stage on a whole-run or per-module score under the break, and always leaves
    // reports/mutation/; the stage's post publishes the HTML report and stashes the JSON for the `mutation` badge
    // that the pipeline's post { always } sets from the score.
    stage('Mutation') {
      when {
        beforeAgent true
        allOf {
          expression { isNightly() }
          anyOf {
            expression { env.BUILD_DAY == '1' }
            expression { params.EXTENDED == true }
          }
        }
      }
      agent { label 'arm64 && docker && s3-browser' }
      options { timeout(time: 90, unit: 'MINUTES') }
      steps {
        script { gateStage('Mutation') }
        sh 'git clean -ffdxq'
        nodeSh('npm ci --no-audit --no-fund')
        nodeSh('npm run mutation')
      }
      post {
        always {
          publishHTML([reportName: 'Mutation', reportDir: 'reports/mutation', reportFiles: 'mutation.html',
                       keepAll: true, alwaysLinkToLastBuild: true, allowMissing: true])
          stash name: 'mutation-results', allowEmpty: true, includes: 'reports/mutation/**'
        }
      }
    }
  }

  post {
    // Reports on every outcome, so a red build still shows what ran. The pipeline agent is none: the reports
    // are built on a phone from the stashes Quality and the e2e shards left (a stash a stage never reached is skipped).
    always {
      script {
        node('arm64 && docker && s3-browser') {
          checkout scm
          sh 'git clean -ffdxq'
          Map stashes = ['quality-results': '.', 'e2e-results-1': 'e2e-1', 'e2e-results-2': 'e2e-2', 'e2e-results-3': 'e2e-3',
                              'mutation-results': '.',
                              'stability-results': '.', 'trivy-fresh-results': '.',
                              'soak-results-1': 'soak-1', 'soak-results-2': 'soak-2', 'soak-results-3': 'soak-3']
          for (def entry : stashes.entrySet()) {
            try {
              dir(entry.value) {
                unstash entry.key
              }
            } catch (err) {
              echo "No stash ${entry.key} (its stage did not reach the end): ${err.message}"
            }
          }
          // The soak's flaky marking: one run of ci/mark-flaky.mjs over the JSON reports of all three shards (their JUnit
          // files are rewritten in place), since --shard spreads a test's repeats over the shards. Skipped when the
          // soak did not run or a shard left no report.
          String soakJunit = ''
          String soakReports = ''
          for (int shard = 1; shard <= 3; shard++) {
            if (fileExists("soak-${shard}/test-results/results.json") && fileExists("soak-${shard}/junit/e2e-junit.xml")) {
              soakJunit += " --junit soak-${shard}/junit/e2e-junit.xml"
              soakReports += " soak-${shard}/test-results/results.json"
            }
          }
          if (soakReports) {
            catchError(buildResult: 'UNSTABLE', stageResult: 'FAILURE') {
              nodeSh("mkdir -p reports && node ci/mark-flaky.mjs${soakJunit} --count-file reports/flaky-count-soak.txt${soakReports}")
            }
          }
          // The nightly lane's flaky count: the sum of what ci/mark-flaky.mjs wrote for Stability and for the soak.
          // Absent when none of them ran, which the summary and the Telegram message read as "not measured".
          int flakyTotal = 0
          boolean flakyMeasured = false
          for (String counted : ['reports/flaky-count-stability.txt', 'reports/flaky-count-soak.txt']) {
            if (fileExists(counted)) {
              flakyMeasured = true
              flakyTotal += readFile(counted).trim().toInteger()
            }
          }
          if (flakyMeasured) {
            writeFile file: 'reports/flaky-count.txt', text: "${flakyTotal}\n"
          }
          // Unit JUnit from Quality, e2e JUnit from each shard. skipMarkingBuildUnstable: a failing test already fails its stage.
          junit testResults: 'junit/junit.xml, e2e-*/junit/e2e-junit.xml', allowEmptyResults: true,
                skipMarkingBuildUnstable: true, skipPublishingChecks: true
          // One Allure report from the unit and every shard's e2e results, with the trend history of the previous
          // build (history.jsonl inside the archived allure-history/) copied in before it is generated.
          copyArtifacts projectName: env.JOB_NAME, selector: lastCompleted(), filter: 'allure-history/**',
                        target: 'previous', optional: true, fingerprintArtifacts: false
          catchError(buildResult: 'UNSTABLE', stageResult: 'FAILURE') {
            sh '''
              mkdir -p allure-report allure-history
              if [ -f previous/allure-history/history.jsonl ]; then cp previous/allure-history/history.jsonl allure-report/history.jsonl; fi
              inputs=""
              for d in allure-results-unit e2e-1/allure-results e2e-2/allure-results e2e-3/allure-results; do
                if [ -d "$d" ]; then inputs="$inputs $d"; fi
              done
              echo "$inputs" > allure-inputs.txt
            '''
            nodeSh('npx --yes allure@3.20.1 generate $(cat allure-inputs.txt) --config scripts/allurerc.mjs --output allure-report')
            sh 'if [ -f allure-report/history.jsonl ]; then cp allure-report/history.jsonl allure-history/history.jsonl; fi'
          }
          publishHTML([reportName: 'Allure', reportDir: 'allure-report', reportFiles: 'index.html',
                       keepAll: true, alwaysLinkToLastBuild: true, allowMissing: true])
          // The CI summary page: unit and e2e counts, coverage against the thresholds, CRAP and the flaky count,
          // rendered by scripts/summary from the reports above (a missing report reads as "no data").
          catchError(buildResult: 'UNSTABLE', stageResult: 'FAILURE') {
            nodeSh('node scripts/summary/summary.ts html ci-summary')
          }
          publishHTML([reportName: 'CI summary', reportDir: 'ci-summary', reportFiles: 'index.html',
                       keepAll: true, alwaysLinkToLastBuild: true, allowMissing: true])
          // The flaky count for the Telegram message in post { cleanup } (ci/mark-flaky.mjs writes it in the nightly lane).
          env.FLAKY_COUNT = fileExists('reports/flaky-count.txt') ? readFile('reports/flaky-count.txt').trim() : 'not measured'
          // README badges, served publicly at https://int21h.mooo.com/jenkins-static/s3-browser/ci/<branch>/<id>.svg
          // (`build` is the plugin's own). Declared on every build, so a build without a report shows "not run" and
          // never the previous build's numbers; scripts/badges/jenkins.ts computes status and colour from the reports.
          def badges = [
            tests: addEmbeddableBadgeConfiguration(id: 'tests', subject: 'tests', status: 'not run', color: 'lightgrey'),
            coverage: addEmbeddableBadgeConfiguration(id: 'coverage', subject: 'coverage', status: 'not run', color: 'lightgrey'),
            quality: addEmbeddableBadgeConfiguration(id: 'quality', subject: 'quality', status: 'not run', color: 'lightgrey'),
            mutation: addEmbeddableBadgeConfiguration(id: 'mutation', subject: 'mutation', status: 'not run', color: 'lightgrey'),
          ]
          catchError(buildResult: 'UNSTABLE', stageResult: 'FAILURE') {
            nodeSh('npm run --silent badges:ci -- ci-summary/badges.txt')
            for (String line : readFile('ci-summary/badges.txt').split('\n')) {
              int eq = line.indexOf('=')
              int bar = line.lastIndexOf('|')
              if (eq > 0 && bar > eq && badges.containsKey(line.substring(0, eq))) {
                badges[line.substring(0, eq)].setStatus(line.substring(eq + 1, bar))
                badges[line.substring(0, eq)].setColor(line.substring(bar + 1))
              }
            }
          }
          archiveArtifacts artifacts: 'coverage/**, reports/eslint.json, sbom/**, reports/trivy.txt, e2e-*/playwright-report/**, allure-history/**, reports/trivy-fresh.txt, reports/flaky-count.txt, reports/stability-junit.xml, stability-out/**, soak-*/junit/**, reports/flaky-count-soak.txt',
                           allowEmptyArchive: true
        }
      }
    }
    // The candidate is archived before the gate turns green, so a green master sha always has one; an archive that
    // fails leaves the build failed and the gate red. Only master builds are candidates.
    success {
      script {
        if (env.BRANCH_NAME == 'master') {
          archiveReleaseCandidate()
        }
        finishGate('success', 'All stages passed')
      }
    }
    // FAILURE, ABORTED and UNSTABLE alike: only a succeeded build may leave a green gate.
    unsuccessful {
      script { finishGate('failure', "Build ${currentBuild.currentResult.toLowerCase()} in stage ${env.GATE_STAGE ?: 'startup'}") }
    }
    // The Telegram message, one per build, last: cleanup runs after every other post condition, so it carries the
    // final result. A sound only for a FAILURE or ABORTED build of master or of the nightly lane; everything else
    // arrives silently. Best-effort: the whole call is inside try/catch, so a Telegram outage (or a missing agent)
    // is logged and never changes the build result. Nothing may follow it in this block.
    cleanup {
      script {
        String result = currentBuild.currentResult
        boolean sound = (env.BRANCH_NAME == 'master' || isNightly()) && (result == 'FAILURE' || result == 'ABORTED')
        try {
          node('arm64 && docker && s3-browser') {
            notifyTelegram(notifyOn: 'ALL', silent: !sound,
                           extra: "Result: ${result} · flaky tests: ${env.FLAKY_COUNT ?: 'not measured'}" + (isNightly() ? ' · nightly (extended lane)' : ''))
          }
        } catch (err) {
          echo "Telegram notification failed (the build result is unchanged): ${err.message}"
        }
      }
    }
  }
}
