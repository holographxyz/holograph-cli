import YAML from 'yaml'
import * as path from 'node:path'

import {CONFIG_FILE_NAME} from '../../utils/config'
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
    const config = await this.readConfig(path.join(this.config.configDir, CONFIG_FILE_NAME))
    const {flags} = await this.parse(ConfigView)

    switch (flags.output) {
      case 'json':
        this.log(JSON.stringify(config.networks, null, 2))
        break
      case 'yaml':
        const yaml = new YAML.Document()
        yaml.contents = config.networks
        this.log(yaml.toString())
        break
      case 'clean':
      default:
        this.log(JSON.stringify(config, null, 2))
        break
    }
  }
}
