import {Command, Flags} from '@oclif/core'
import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'
import * as path from 'node:path'

export default class Hello extends Command {
  static description = 'Say hello'

  static examples = [
    `$ oex hello friend --from oclif
hello friend from oclif! (./src/commands/hello/index.ts)
`,
  ]

  static flags = {
    from: Flags.string({char: 'f', description: 'Whom is saying hello', required: true}),
  }

  static args = [{name: 'person', description: 'Person to say hello to', required: true}]

  async run(): Promise<void> {
    // These 2 lines must be at the top of every command!!
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    await ensureConfigFileIsValid(configPath)

    const {args, flags} = await this.parse(Hello)

    this.log(`hello ${args.person} from ${flags.from}! (./src/commands/hello/index.ts)`)
    // TODO: Not sure why this is hanging...
    // process.exit(0)
  }
}
