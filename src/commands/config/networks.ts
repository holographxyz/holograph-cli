import YAML from 'yaml'
import * as path from 'node:path'

import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'
import ConfigView from './view'

export default class ConfigNetworks extends ConfigView {
  static description = 'View the current network config'
  static examples = [
    '$ holo:networks',
    '$ holo:networks --output json',
    '$ holo:networks --output yaml',
    '$ holo:networks --output clean',
  ]

  async run(): Promise<void> {
    const {flags} = await this.parse(ConfigView)
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    await ensureConfigFileIsValid(configPath)
    const config = await this.readConfig(configPath)
    const yaml = new YAML.Document()
    const configJson = JSON.parse(JSON.stringify(config.networks))

    switch (flags.output) {
      case 'json':
        this.log(JSON.stringify(config.networks, null, 2))
        break
      case 'yaml':
        yaml.contents = config.networks
        this.log(yaml.toString())
        break
      case 'clean':
      default:
        this.serializeClean(configJson, '')
        break
    }

    this.exit()
  }
}
