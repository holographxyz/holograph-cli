import {Hook} from '@oclif/core'
import color from '@oclif/color'

enum Environment {
  LOCALHOST = 'localhost',
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
    'create',
    'create:contract',
    'create:nft',
  ]

  const indexOfUnsafeFlag = argv.indexOf('--unsafe')
  const unsafe = indexOfUnsafeFlag !== -1

  if (environment === Environment.MAINNET && commandsDisableForMainnet.includes(commandName)) {
    console.error(color.red(`The ${commandName} command is currently disabled on mainnet.`))

    if (unsafe && (commandName.includes('operator') || commandName.includes('indexer'))) {
      console.warn(color.yellow('Executing command on UNSAFE mode...'))
      argv.splice(indexOfUnsafeFlag)
    } else {
      // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
      process.exit(0)
    }
  }
}

function validateDisabledCommands(commandName: string) {
  const commandsDisableTemporarily: string[] = [] // add commands to disable on all envs here

  if (commandsDisableTemporarily.includes(commandName)) {
    console.error(color.red(`The ${commandName} command is temporarily disabled.`))
    // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
    process.exit(0)
  }
}

const environmentSelectorHook: Hook<'init'> = async function ({id, argv}) {
  validateDisabledCommands(String(id))

  if (id !== 'config' && id !== undefined) {
    const env: string | undefined = process.env.ABI_ENVIRONMENT || process.env.HOLOGRAPH_ENVIRONMENT || undefined
    const indexOfEnv = argv.indexOf('--env')

    let environment
    if (env !== undefined) {
      environment = env
    } else if (indexOfEnv !== -1) {
      environment = argv[indexOfEnv + 1]
      argv.splice(indexOfEnv, 2)
    }

    if (environment === undefined || environment === '') {
      this.log(
        color.yellow(
          'WARNING: Environment not identified. Set HOLOGRAPH_ENVIRONMENT to develop, testnet, or mainnet in your .env file or set it via the --env flag',
        ),
      )
      // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
      return process.exit(0)
    }

    validateDisabledCommandsOnMainnet(environment, id, argv)

    if ((Object.values(Environment) as string[]).includes(environment)) {
      process.env.HOLOGRAPH_ENVIRONMENT = environment
    }
  }
}

export default environmentSelectorHook
