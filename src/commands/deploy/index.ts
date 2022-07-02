import {Command} from '@oclif/core'
import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'
import * as path from 'node:path'

export default class Deploy extends Command {
  static description = 'Make a deploy request'
  static examples = ['$ holo deploy', '$ holo deploy:contract']

  async run(): Promise<void> {
    // These 2 lines must be at the top of every command!!
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    await ensureConfigFileIsValid(configPath)
    await this.parse(Deploy)

    this.log(`Welcome to Holograph Factory 🌉`)
    this.log(`To deploy a holographable contract, view the help menu by running: holo deploy --help`)
  }
}
