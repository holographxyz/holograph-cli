import YAML from 'yaml'
import * as path from 'node:path'

import ConfigView from './view'
import {CONFIG_FILE_NAME, ensureConfigFileIsValid, readConfig} from '../../utils/config'

export default class ConfigUser extends ConfigView {
  static description = 'View the current user address'
  static examples = [
    '$ holo:user',
    '$ holo:user --output json',
    '$ holo:user --output yaml',
    '$ holo:user --output clean',
  ]

  async run(): Promise<void> {
    const {flags} = await this.parse(ConfigView)
    await this.setup()

    switch (flags.output) {
      case 'json':
        this.log(JSON.stringify({user: this.configJson.user.credentials.address}, null, 2))
        break
      case 'yaml':
        this.yaml.contents = {user: this.configJson.user.credentials.address} as any
        this.log(this.yaml.toString())
        break
      case 'clean':
      default:
        this.log(`User address: ${this.configJson.user.credentials.address}`)
        break
    }

    this.exit()
  }
}
