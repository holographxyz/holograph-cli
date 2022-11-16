import {Help, Interfaces} from '@oclif/core'

export default class CustomHelp extends Help {
  formatCommand(command: Interfaces.Command): string {
    if (command.id === 'config') {
      return super.formatCommand(command)
    }

    command.examples = command.examples?.map(example => {
      if (typeof example === 'string') {
        example += ' --env mainnet|testnet|develop|experimental'
      } else if (typeof example.command === 'string') {
        example.command += ' --env mainnet|testnet|develop|experimental'
      }

      return example
    })

    command.flags = {
      ...command.flags,
      env: {
        name: 'env',
        type: 'option',
        description: 'Holograph environment to use',
        options: ['mainnet', 'testnet', 'develop', 'experimental'],
        default: 'testnet',
      },
    }

    return super.formatCommand(command)
  }
}
