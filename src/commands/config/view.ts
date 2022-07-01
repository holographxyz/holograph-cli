import YAML from 'yaml'

import * as path from 'node:path'
import Config from '.'
import {Flags} from '@oclif/core'

import {CONFIG_FILE_NAME} from '../../utils/config'
import {capitalize} from '../../utils/utils'

export default class ConfigView extends Config {
  static description = 'View the current configuration state of the Holo command line'
  static examples = [
    '$ holo:view',
    '$ holo:view --output json',
    '$ holo:view --output yaml',
    '$ holo:view --output clean',
  ]

  static flags = {
    ...Config.flags,
    output: Flags.string({description: 'Output format', options: ['clean', 'json', 'yaml']}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ConfigView)
    const configFileName = CONFIG_FILE_NAME
    const configPath = path.join(this.config.configDir, configFileName)
    this.config = await this.readConfig(configPath)
    this.debug(`Configuration path ${configPath}`)
    const yaml = new YAML.Document()
    const configJson = JSON.parse(JSON.stringify(this.config))

    switch (flags.output) {
      case 'json':
        this.log(JSON.stringify(this.config, null, 2))
        break
      case 'yaml':
        yaml.contents = this.config as any
        this.log(yaml.toString())
        break
      case 'clean':
      default:
        this.serializeClean(configJson, '')
        break
    }
  }

  serializeClean(obj: any, tabCursor: string): void {
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') {
        tabCursor = '  '
        this.log(`${capitalize(key)}:`)
        this.serializeClean(obj[key], tabCursor)
      } else {
        this.log(`${tabCursor}${capitalize(key)}: ${obj[key]}`)
      }
    }
  }
}
