import {Hook} from '@oclif/core'
import color from '@oclif/color'

enum Environment {
  EXPERIMENTAL = 'experimental',
  DEVELOP = 'develop',
  TESTNET = 'testnet',
  MAINNET = 'mainnet',
}

function validateDisabledCommandsOnMainnet(environment: string, commandName: string, argv: string[]) {
  const commandsDisableForMainnet = [
    'faucet',
    'operator',
    'operator:bond',
    'operator:unbond',
    'operator:recover',
    'indexer',
  ]

  const indexOfArg = argv.indexOf('--unsafe')
  const unsafe = indexOfArg !== -1

  if (environment === Environment.MAINNET && commandsDisableForMainnet.includes(commandName)) {
    console.error(color.red(`The ${commandName} command is currently disabled on mainnet.`))

    if (unsafe && (commandName.includes('operator') || commandName.includes('indexer'))) {
      console.warn(color.yellow('Executing command on UNSAFE mode...'))
      argv.splice(indexOfArg)
    } else {
      // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
      process.exit(0)
    }
  }
}

function validateDisabledCommands(commandName: string) {
  const commandsDisableTemporarily = ['create', 'create:contract', 'create:nft']

  if (commandsDisableTemporarily.includes(commandName)) {
    console.error(color.red(`The ${commandName} command is temporarily disabled.`))
    // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
    process.exit(0)
  }
}

const environmentSelectorHook: Hook<'init'> = async function ({id, argv}) {
  validateDisabledCommands(String(id))

  if (id !== 'config' && id !== undefined) {
    const indexOfEnv = argv.indexOf('--env')

    process.env.HOLOGRAPH_ENVIRONMENT = Environment.TESTNET

    if (indexOfEnv !== -1) {
      const environment = argv[indexOfEnv + 1]
      argv.splice(indexOfEnv, 2)

      validateDisabledCommandsOnMainnet(environment, id, argv)

      if ((Object.values(Environment) as string[]).includes(environment)) {
        process.env.HOLOGRAPH_ENVIRONMENT = environment
      } else {
        this.log(color.yellow('WARNING: Environment not identified. Using "testnet"...'))
      }
    }
  }
}

export default environmentSelectorHook
