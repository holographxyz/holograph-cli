import YAML from 'yaml'
import * as fs from 'fs-extra'
import * as path from 'node:path'

import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'
import ConfigView from './view'
import inquirer from 'inquirer'

export default class ConfigNetworks extends ConfigView {
  static description = 'View the current network config'
  static examples = [
    '$ holo:networks',
    '$ holo:networks --output json',
    '$ holo:networks --output yaml',
    '$ holo:networks --output clean',
  ]

  supportedNetworks: string[] = ['rinkeby', 'mumbai', 'fuji']
  defaultFrom!: string
  defaultTo!: string

  async run(): Promise<void> {
    const {flags} = await this.parse(ConfigView)
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    await ensureConfigFileIsValid(configPath)
    const config = await this.readConfig(configPath)
    const yaml = new YAML.Document()
    const configJson = JSON.parse(JSON.stringify(config))

    const prompt: any = await inquirer.prompt([
      {
        name: 'update',
        message: 'Would you like to update your network config?',
        type: 'confirm',
        default: false,
      },
    ])
    if (prompt.update) {
      // Array will get smaller depending on input defaultFrom and defaultTo values. I copy value so I can manipulate it
      let remainingNetworks = this.supportedNetworks
      this.debug(`remainingNetworks = ${remainingNetworks}`)

      // Collect default FROM network value
      remainingNetworks = remainingNetworks.filter((item: string) => {
        return item !== this.defaultTo
      })
      this.debug(`remainingNetworks = ${remainingNetworks}`)
      const fromPrompt: any = await inquirer.prompt([
        {
          name: 'defaultFrom',
          message: 'Select the default network to bridge FROM (origin network)',
          type: 'list',
          choices: remainingNetworks,
        },
      ])
      this.defaultFrom = fromPrompt.defaultFrom

      // Collect default TO network value
      remainingNetworks = remainingNetworks.filter((item: string) => {
        return item !== this.defaultFrom
      })
      this.debug(`remainingNetworks = ${remainingNetworks}`)
      const toPrompt: any = await inquirer.prompt([
        {
          name: 'defaultTo',
          message: 'Select the default network to bridge TO (destination network)',
          type: 'list',
          choices: remainingNetworks,
        },
      ])
      this.defaultTo = toPrompt.defaultTo

      configJson.networks.from = this.defaultFrom
      configJson.networks.to = this.defaultTo

      for (const network of this.supportedNetworks) {
        const prompt: any = await inquirer.prompt([
          {
            name: 'providerUrl',
            message: `Enter the provider url for ${network}`,
            type: 'input',
            validate: async (input: string) => {
              if (!this.isStringAValidURL(input)) {
                return 'Input is not a valid and secure URL (https or wss)'
              }

              return true
            },
          },
        ])

        configJson.networks[network].providerUrl = prompt.providerUrl
      }

      try {
        await fs.outputJSON(configPath, configJson, {spaces: 2})
      } catch (error: any) {
        this.log(`Failed to save file in ${configPath}. Please enable debugger and try again.`)
        this.debug(error)
      }
    }

    switch (flags.output) {
      case 'json':
        this.log(JSON.stringify(config.networks, null, 2))
        break
      case 'yaml':
        yaml.contents = config.networks
        this.log(yaml.toString())
        break
      case 'clean':
      default:
        this.serializeClean(configJson.networks, '')
        break
    }

    this.exit()
  }

  public isStringAValidURL(s: string): boolean {
    const protocols = ['https', 'wss']
    try {
      const result = new URL(s)
      this.debug(`provider protocol is ${result.protocol}`)
      return result.protocol ? protocols.map(x => `${x.toLowerCase()}:`).includes(result.protocol) : false
    } catch (error) {
      this.debug(error)
      return false
    }
  }
}
