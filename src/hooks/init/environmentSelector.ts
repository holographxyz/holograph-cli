import {Flags, Hook, toStandardizedId} from '@oclif/core'

enum Environment {
  EXPERIMENTAL = 'experimental',
  DEVELOP = 'develop',
  TESTNET = 'testnet',
  MAINNET = 'mainnet',
}

const environmentSelectorHook: Hook<'init'> = async function ({id, argv}) {
  // if (id !== 'config') {
  //   const indexOfEnv = argv.indexOf('--env')
  //   process.env.HOLOGRAPH_ENVIRONMENT = Environment.MAINNET
  //   if (indexOfEnv !== -1) {
  //     const environment = argv[indexOfEnv + 1]
  //     argv.splice(indexOfEnv, 2)
  //     if ((Object.values(Environment) as string[]).includes(environment)) {
  //       process.env.HOLOGRAPH_ENVIRONMENT = environment
  //     } else {
  //       this.log('WARNING: Environment not identified. Using "mainnet"...')
  //     }
  //   }
  // }
}

export default environmentSelectorHook
