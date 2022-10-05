import {Command} from '@oclif/core'
import {ensureConfigFileIsValid} from '../../utils/config'

export default class Bridge extends Command {
  static description = 'Make a bridge request'
  static examples = ['$ holograph bridge', '$ holograph bridge:contract']

  async run(): Promise<void> {
    await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    await this.parse(Bridge)

    this.log(`Welcome to the Holograph Bridge 🌉`)
    this.log(`To get started, view the help menu by running: holograph bridge --help`)

    this.exit()
  }
}
