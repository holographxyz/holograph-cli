import * as fs from 'fs-extra'

enum Environment {
  develop = 'develop',
  testnet = 'testnet',
  mainnet = 'mainnet',
}

const getEnvironment = (): Environment => {
  let environment = Environment.develop
  const acceptableBranches: Set<string> = new Set<string>(['develop', 'testnet', 'mainnet'])
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

export {Environment, getEnvironment}
