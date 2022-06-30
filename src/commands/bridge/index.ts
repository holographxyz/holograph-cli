import {Command, Flags} from '@oclif/core'
import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'
import * as path from 'node:path'

export default class Bridge extends Command {
  static description = 'Make a bridge request'

  static examples = []

  static flags = {}

  static args = []

  async run(): Promise<void> {
    // These 2 lines must be at the top of every command!!
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    await ensureConfigFileIsValid(configPath)

    const {args, flags} = await this.parse(Bridge)

    this.log(`it works`)
  }
}
