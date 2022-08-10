import {Command} from '@oclif/core'
import {ensureConfigFileIsValid} from '../../utils/config'

export default class Deploy extends Command {
  static description = 'Make a deploy request'
  static examples = ['$ holo deploy', '$ holo deploy:contract']

  async run(): Promise<void> {
    await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    await this.parse(Deploy)

    this.log(`Welcome to Holograph Factory 🌉`)
    this.log(`To deploy a holographable contract, view the help menu by running: holo deploy --help`)

    this.exit()
  }
}
