import * as fs from 'fs-extra'

import {CONFIG_FILE_NAME} from '../../utils/config'
import path from 'path'

import ConfigView from './view'

export default class ConfigUser extends ConfigView {
  static description = 'View the current configuration state of the Holo command line'
  static examples = ['$ holo:view']

  async run(): Promise<void> {
    let user = this.user

    const configFileName = CONFIG_FILE_NAME
    const configPath = path.join(this.config.configDir, configFileName)
    this.debug(`configuration path ${configPath}`)

    const isConfigExist: boolean = await this.checkFileExists(configPath)
    this.debug(`Configuration file exists = ${isConfigExist}`)

    const config = await this.readConfig(configPath)
    this.log(`User address: ${config.user.credentials.address}`)
  }
}
