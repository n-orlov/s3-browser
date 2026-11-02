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

// The PR head sha a status belongs to. A PR build checks out the target merged INTO the PR head;
// when that merge is not a fast-forward, HEAD is a merge commit whose first parent is the PR head.
def gateSha() {
  return sh(returnStdout: true, script: '''
    if [ -n "$CHANGE_ID" ] && git rev-parse -q --verify HEAD^2 >/dev/null; then git rev-parse HEAD^1; else git rev-parse HEAD; fi
  ''').trim()
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

  stages {
    stage('Quality') {
      agent { label 'arm64 && docker && s3-browser' }
      options { timeout(time: 30, unit: 'MINUTES') }
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
        nodeSh('npm ci --no-audit --no-fund')
        nodeSh('npm run typecheck')
        nodeSh('npm run lint')
        nodeSh('npm run test:coverage')
        nodeSh('npm run crap')
        nodeSh('npm run ratchet:check')
        nodeSh('npm run audit:prod')
        sh 'ci/trivy.sh'
        nodeSh('npm run build')
        nodeSh('npm run sbom')
      }
    }
  }

  post {
    success {
      script { finishGate('success', 'All stages passed') }
    }
    // FAILURE, ABORTED and UNSTABLE alike: only a succeeded build may leave a green gate.
    unsuccessful {
      script { finishGate('failure', "Build ${currentBuild.currentResult.toLowerCase()} in stage ${env.GATE_STAGE ?: 'startup'}") }
    }
  }
}
