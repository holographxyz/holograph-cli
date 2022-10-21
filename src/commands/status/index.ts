import {Command} from '@oclif/core'
import {ensureConfigFileIsValid} from '../../utils/config'

export default class Status extends Command {
  static description = 'Get the status of a contract or NFT'
  static examples = [
    {
      description: 'Learn how to get the status of a contract',
      command: '<%= config.bin %> status:contract --help',
    },
    {
      description: 'Learn how to get the status of an NFT',
      command: '<%= config.bin %> status:nft --help',
    },
  ]

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    await this.parse(Status)

    this.log(`Welcome to the Holograph Asset Status command`)
    this.log(`To get started, view the help menu by running: holograph status --help`)

    this.exit()
  }
}
