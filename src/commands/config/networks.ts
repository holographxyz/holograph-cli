import {CONFIG_FILE_NAME} from '../../utils/config'
import * as path from 'node:path'

import ConfigNetworks from './view'

export default class ConfigUser extends ConfigNetworks {
  static description = 'View the current network config'
  static examples = ['$ holo:view']

  async run(): Promise<void> {
    const config = await this.readConfig(path.join(this.config.configDir, CONFIG_FILE_NAME))
    this.log(`Network config: ${JSON.stringify(config.networks, null, 2)}`)
  }
}
