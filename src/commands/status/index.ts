import {Command} from '@oclif/core'
import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'
import * as path from 'node:path'

export default class Status extends Command {
  static description = 'Get asset status'
  static examples = ['$ holo status', '$ holo status:contract', '$ holo status:nft']

  async run(): Promise<void> {
    // These 2 lines must be at the top of every command!!
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    await ensureConfigFileIsValid(configPath, undefined, false)
    await this.parse(Status)

    this.log(`Welcome to the Holograph Asset Status command`)
    this.log(`To get started, view the help menu by running: holo status --help`)

    this.exit()
  }
}
