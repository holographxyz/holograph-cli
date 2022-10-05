import {Command} from '@oclif/core'
import {ensureConfigFileIsValid} from '../../utils/config'

export default class Status extends Command {
  static description = 'Get asset status'
  static examples = ['$ holograph status', '$ holograph status:contract', '$ holograph status:nft']

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
