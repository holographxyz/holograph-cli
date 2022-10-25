import ConfigView from './view'

export default class ConfigNetworks extends ConfigView {
  static description = 'View the current network config'
  static examples = [
    '$ <%= config.bin %> <%= command.id %>',
    '$ <%= config.bin %> <%= command.id %> --output json',
    '$ <%= config.bin %> <%= command.id %> --output yaml',
    '$ <%= config.bin %> <%= command.id %> --output clean',
  ]

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    const {flags} = await this.parse(ConfigView)
    await this.setup()

    switch (flags.output) {
      case 'json':
        this.log(JSON.stringify(this.configJson.networks, null, 2))
        break
      case 'yaml':
        this.yaml.contents = this.configJson.networks
        this.log(this.yaml.toString())
        break
      case 'clean':
      default:
        this.serializeClean(this.configJson.networks, '')
        break
    }

    this.exit()
  }
}
