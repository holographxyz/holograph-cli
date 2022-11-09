import ConfigView from './view'

export default class ConfigUser extends ConfigView {
  static description = 'View the current user information.'
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
        this.log(JSON.stringify({user: this.configJson.user.credentials.address}, null, 2))
        break
      case 'yaml':
        this.yaml.contents = {user: this.configJson.user.credentials.address} as any
        this.log(this.yaml.toString())
        break
      case 'clean':
      default:
        this.log(`User address: ${this.configJson.user.credentials.address}`)
        break
    }

    this.exit()
  }
}
