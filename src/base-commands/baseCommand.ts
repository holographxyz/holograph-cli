import {Command, Flags, Interfaces} from '@oclif/core'

export abstract class BaseCommand extends Command {
  static flags = {
    env: Flags.string({
      description: 'This flag allows you to choose the environment',
      default: 'mainnet',
      options: ['mainnet', 'testnet', 'develop', 'experimental'],
    }),
  }

  async init(): Promise<void> {
    await super.init()
    const {flags} = await this.parse(this.constructor as Interfaces.Command.Class)

    process.env.HOLOGRAPH_ENVIRONMENT = flags.env
  }
}
