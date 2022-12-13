import {Command} from '@oclif/core'

import {ensureConfigFileIsValid} from '../../utils/config'

export default class Create extends Command {
  static description = 'Create Holographable contracts and NFTs.'
  static examples = [
    '$ <%= config.bin %> create',
    '$ <%= config.bin %> create:contract',
    '$ <%= config.bin %> create:nft',
  ]

  async run(): Promise<void> {
    await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    await this.parse(Create)

    this.log('Make it holographable')
    this.log(`To deploy/create holographable contracts or assets, view the help menu by running: holo create --help`)

    this.exit()
  }
}
