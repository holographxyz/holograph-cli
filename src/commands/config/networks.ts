import * as fs from 'fs-extra'

import {CONFIG_FILE_NAME} from '../../utils/config'
import path from 'path'

import ConfigNetworks from './view'

export default class ConfigUser extends ConfigNetworks {
  static description = 'View the current configuration state of the Holo command line'
  static examples = ['$ holo:view']

  async run(): Promise<void> {
    const config = await this.readConfig(path.join(this.config.configDir, CONFIG_FILE_NAME))
    this.log(`Network config: ${JSON.stringify(config.networks, null, 2)}`)
  }
}
