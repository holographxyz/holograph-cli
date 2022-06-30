import * as fs from 'fs-extra'

import {CONFIG_FILE_NAME} from '../../utils/config'
import path from 'path'
import Config from '.'

export default class ConfigView extends Config {
  static description = 'View the current configuration state of the Holo command line'
  static examples = ['$ holo:view']

  user: string | undefined

  async run(): Promise<void> {
    let user = this.user

    const configFileName = CONFIG_FILE_NAME
    const configPath = path.join(this.config.configDir, configFileName)
    this.debug(`configuration path ${configPath}`)

    const isConfigExist: boolean = await this.checkFileExists(configPath)
    this.debug(`Configuration file exists = ${isConfigExist}`)

    const config = await this.readConfig(configPath)
    this.log(config)
  }

  public async readConfig(configPath: string) {
    try {
      return await fs.readJSON(configPath)
    } catch (error) {
      this.debug(error)
      this.error('Failed to find config file')
    }
  }
}
