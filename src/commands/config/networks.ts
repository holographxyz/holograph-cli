import ConfigView from './view'

export default class ConfigNetworks extends ConfigView {
  static description = 'View the current network config'
  static examples = [
    '$ holo:networks',
    '$ holo:networks --output json',
    '$ holo:networks --output yaml',
    '$ holo:networks --output clean',
  ]

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
