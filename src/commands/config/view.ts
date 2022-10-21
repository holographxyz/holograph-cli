import YAML from 'yaml'
import * as path from 'node:path'
import {Command, Flags} from '@oclif/core'

import {CONFIG_FILE_NAME, ensureConfigFileIsValid, readConfig} from '../../utils/config'
import {capitalize} from '../../utils/utils'
import {supportedFormats} from '../../utils/output-format'

export default class ConfigView extends Command {
  static description = 'View the current configuration state of the Holograph command line'
  static examples = [
    '$ <%= config.bin %> <%= command.id %>',
    '$ <%= config.bin %> <%= command.id %> --output json',
    '$ <%= config.bin %> <%= command.id %> --output yaml',
    '$ <%= config.bin %> <%= command.id %> --output clean',
  ]

  static flags = {
    output: Flags.string({
      description: 'Output format',
      options: supportedFormats,
    }),
  }

  yaml!: YAML.Document
  configJson: any
  configPath!: string

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    const {flags} = await this.parse(ConfigView)
    await this.setup()

    switch (flags.output) {
      case 'json':
        this.log(JSON.stringify(this.config, null, 2))
        break
      case 'yaml':
        this.yaml.contents = this.config as any
        this.log(this.yaml.toString())
        break
      case 'clean':
      default:
        this.serializeClean(this.configJson, '')
        break
    }

    this.exit()
  }

  public async setup(): Promise<void> {
    this.configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    await ensureConfigFileIsValid(this.configPath, undefined, false)
    this.config = await readConfig(this.configPath)

    if (!this.config) {
      this.error('No config file found')
    }

    this.debug(`Configuration path ${this.configPath}`)
    this.yaml = new YAML.Document()
    this.configJson = JSON.parse(JSON.stringify(this.config))
  }

  public serializeClean(obj: Record<string, unknown>, tabCursor: string): void {
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') {
        tabCursor = '  '
        this.log(`${capitalize(key)}:`)
        this.serializeClean(obj[key] as Record<string, unknown>, tabCursor)
      } else {
        this.log(`${tabCursor}${capitalize(key)}: ${obj[key]}`)
      }
    }
  }
}
