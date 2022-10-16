import * as fs from 'fs-extra'
import dotenv from 'dotenv'
dotenv.config()

enum Environment {
  experimental = 'experimental',
  develop = 'develop',
  testnet = 'testnet',
  mainnet = 'mainnet',
}

const getEnvironment = (): Environment => {
  let environment = Environment.experimental
  const acceptableBranches: Set<string> = new Set<string>(Object.values(Environment))
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
  console.log(`Environment=${environment}`)

  return environment
}

export {Environment, getEnvironment}
