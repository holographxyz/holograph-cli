import {Command} from '@oclif/core'
import {ensureConfigFileIsValid} from '../../utils/config'

export default class Deploy extends Command {
  static hidden = true
  static description = 'Make a deploy request to another network'
  static examples = [
    {
      description: 'Learn how to deploy a contract',
      command: '<%= config.bin %> deploy:contract --help',
    }
  ]

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    await this.parse(Deploy)

    this.log(`Welcome to Holograph Factory 🌉`)
    this.log(`To deploy a holographable contract, view the help menu by running: holograph deploy --help`)

    this.exit()
  }
}
