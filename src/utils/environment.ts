import * as fs from 'fs-extra'
import dotenv from 'dotenv'
dotenv.config()

enum Environment {
  experimental = 'experimental',
  develop = 'develop',
  testnet = 'testnet',
  mainnet = 'mainnet',
}

// Description: Get environment by git branch name
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getEnvironmentByGitBranch = (): Environment => {
  let environment = Environment.develop
  const acceptableBranches: Set<string> = new Set<string>(['experimental', 'develop', 'testnet', 'mainnet'])
  const head = './.git/HEAD'
  const env: string = process.env.HOLOGRAPH_ENVIRONMENT || ''
  if (env === '') {
    if (fs.existsSync(head)) {
      const contents = fs.readFileSync('./.git/HEAD', 'utf8')
      const branch = contents.trim().split('ref: refs/heads/')[1]
      if (acceptableBranches.has(branch)) {
        environment = Environment[branch as keyof typeof Environment]
      }
    }
  } else if (acceptableBranches.has(env)) {
    environment = Environment[env as keyof typeof Environment]
  }

  return environment
}

// Description: Get environment by ABI_ENVIRONMENT
const getEnvironment = (): Environment => {
  let environment = Environment.develop
  const acceptableBranches: Array<keyof typeof Environment> = Object.values(Environment)

  if (acceptableBranches.includes(environment as keyof typeof Environment)) {
    environment = Environment[environment as keyof typeof Environment]
  } else {
    throw new Error(`Unknown value for ABI_ENVIRONMENT=${environment}`)
  }

  console.log(`ABI_ENVIRONMENT=${environment}`) // NOTE: remove after deployment
  return environment
}

export {Environment, getEnvironment}
