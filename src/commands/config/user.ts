import {CONFIG_FILE_NAME} from '../../utils/config'
import * as path from 'node:path'

import ConfigView from './view'

export default class ConfigUser extends ConfigView {
  static description = 'View the current user address'
  static examples = ['$ holo:view']

  async run(): Promise<void> {
    const config = await this.readConfig(path.join(this.config.configDir, CONFIG_FILE_NAME))
    this.log(`User address: ${config.user.credentials.address}`)
  }
}
