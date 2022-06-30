import * as fs from 'fs-extra'
import YAML from 'yaml'

import {CONFIG_FILE_NAME} from '../../utils/config'
import * as path from 'node:path'
import Config from '.'
import {Flags} from '@oclif/core'

export default class ConfigView extends Config {
  static description = 'View the current configuration state of the Holo command line'
  static examples = [
    '$ holo:view',
    '$ holo:view --output json',
    '$ holo:view --output yaml',
    '$ holo:view --output clean',
  ]
  static override flags = {
    ...Config.flags,
    output: Flags.string({description: 'Output format', options: ['clean', 'json', 'yaml']}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ConfigView)
    const configFileName = CONFIG_FILE_NAME
    const configPath = path.join(this.config.configDir, configFileName)
    this.config = await this.readConfig(configPath)
    this.debug(`configuration path ${configPath}`)

    switch (flags.output) {
      case 'clean':
        this.log(JSON.stringify(this.config))
        break
      case 'json':
        this.log(JSON.stringify(this.config, null, 2))
        break
      case 'yaml':
        const yaml = new YAML.Document()
        yaml.contents = this.config as any
        this.log(yaml.toString())
        break
      default:
        this.log(JSON.stringify(this.config, null, 2))
        break
    }
  }
}
