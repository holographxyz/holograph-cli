import * as fs from 'fs-extra'
import * as path from 'node:path'

import {CONFIG_FILE_NAME} from '../../utils/config'

import Config from '.'

export default class ConfigView extends Config {
  static description = 'View the current configuration state of the Holo command line'
  static examples = ['$ holo:view']

  async run(): Promise<void> {
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
