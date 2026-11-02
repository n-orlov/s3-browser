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
}
