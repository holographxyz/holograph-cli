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
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    await ensureConfigFileIsValid(configPath)
    const config = await readConfig(configPath)

    if (!config) {
      this.error('No config file found')
    }

    const yaml = new YAML.Document()

    switch (flags.output) {
      case 'json':
        this.log(JSON.stringify({user: config.user.credentials.address}, null, 2))
        break
      case 'yaml':
        yaml.contents = {user: config.user.credentials.address} as any
        this.log(yaml.toString())
        break
      case 'clean':
      default:
        this.log(`User address: ${config.user.credentials.address}`)
        break
    }

    this.exit()
  }
}
