import {Command} from '@oclif/core'

import {ensureConfigFileIsValid} from '../../utils/config'

export default class Bridge extends Command {
  static description = 'Make a bridge request'
  static examples = [
    {
      description: 'Learn how to bridge a Holographable contract',
      command: '<%= config.bin %> bridge:contract --help',
    },
    {
      description: 'Learn how to bridge a Holographable NFT',
      command: '<%= config.bin %> bridge:nft --help',
    },
  ]

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    await this.parse(Bridge)

    this.log(`Welcome to the Holograph Bridge 🌉`)
    this.log(`To get started, view the help menu by running: holograph bridge --help`)

    this.exit()
  }
}
