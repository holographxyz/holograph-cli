import {Help, Interfaces} from '@oclif/core'

export default class CustomHelp extends Help {
  formatCommand(command: Interfaces.Command): string {
    if (command.id === 'config') {
      return super.formatCommand(command)
    }

    command.examples = command.examples?.map(example => example + ' --env mainnet|testnet|develop|experimental')

    command.flags = {
      ...command.flags,
      env: {
        name: 'env',
        type: 'option',
        description: 'Space separated list of networks to use',
        options: ['mainnet', 'testnet', 'develop', 'experimental'],
        default: 'testnet',
      },
    }

    return super.formatCommand(command)
  }
}
