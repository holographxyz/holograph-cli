import {Command, Flags} from '@oclif/core'
import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import * as path from 'path'
import {ethers} from 'ethers'


export default class Init extends Command {
  static description = 'Initialize the Holo command line to become an operator or to bridge collections and NFTs manually'

  static examples = [
    '$ holo --defaultFrom rinkeby',
    '$ holo --defaultFrom rinkeby --defaultTo mumbai',
    '$ holo --privateKey abc...def',
    '$ holo --providerUrl https://rpc.com',
    '$ holo --providerUrl wss://rpc.com',
  ]

  static allowedNetworks = ['rinkeby', 'mumbai']

  static flags = {
    defaultFrom: Flags.string({options: this.allowedNetworks, description: 'Default network to bridge FROM (origin network)'}),
    defaultTo: Flags.string({options: this.allowedNetworks, description: 'Default network to bridge TO (destination network)'}),
    privateKey: Flags.string({description: 'Default account to use when sending all transactions'}),
    providerUrl: Flags.string({description: 'Provide a secure https or wss url'}),
  }

  private async checkFileExists(configPath: string) {
    try {
      return await fs.pathExists(configPath)
    } catch (error) {
      this.debug(error)
      process.exit(0)
    }
  }

  public isStringAValidURL = (s: string) => {
    const protocols = ['https', 'wss']
    try {
      const result = new URL(s)
      this.debug(`provider protocol is ${result.protocol}`)
      return result.protocol ?
        protocols.map(x => `${x.toLowerCase()}:`).includes(result.protocol) :
        false
    } catch (error) {
      this.debug(error)
      return false
    }
  }

  public isFromAndToNetworksTheSame = (from: string | undefined, to: string | undefined) => {
    return   (from !== to)
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Init)

    let defaultFrom = flags.defaultFrom
    let defaultTo = flags.defaultTo
    let privateKey = flags.privateKey
    let providerUrl = flags.providerUrl
    let userWallet = null


    // Make sure default from and to networks are not the same when using flags
    if (typeof defaultFrom !== 'undefined' && typeof defaultTo !== 'undefined') {
      const isValidFromAndTo = this.isFromAndToNetworksTheSame(defaultFrom, defaultTo)
      if (!isValidFromAndTo) {
        this.log('The FROM and TO networks cannot be the same')
        process.exit(0)
      }
    }

    // Check if config file exists
    const configFileName = 'config.json'
    const configPath = path.join(this.config.configDir, configFileName)
    this.debug(`configuration path ${configPath}`)
    const isConfigExist: boolean = await this.checkFileExists(configPath)
    this.debug(`configuration file exists = ${isConfigExist}`)

    if (isConfigExist) {
      const prompt: any = await inquirer.prompt([{
        name: 'shouldContinue',
        message: 'configuration already exist, are you sure you want to override existing values?',
        type: 'confirm',
        default: false,
      }])
      if (!prompt.shouldContinue) {
        this.log('No files were modified')
        process.exit(0)
      }
    }

    // Array will get smaller depending on input defaultFrom and defaultTo values. I copy value so I can manipulate it
    let remainingNetworks = Init.allowedNetworks
    this.debug(`remainingNetworks = ${remainingNetworks}`)

    // Collect default FROM network value
    if (!defaultFrom) {
      remainingNetworks = remainingNetworks.filter((item: string) => {
        return item !== defaultTo
      })
      this.debug(`remainingNetworks = ${remainingNetworks}`)
      const prompt: any = await inquirer.prompt([{
        name: 'defaultFrom',
        message: 'select the default network to bridge FROM (origin network)',
        type: 'list',
        choices: remainingNetworks,
      }])
      defaultFrom = prompt.defaultFrom
    }

    // Collect default TO network value
    if (!defaultTo) {
      remainingNetworks = remainingNetworks.filter((item: string) => {
        return item !== defaultFrom
      })
      this.debug(`remainingNetworks = ${remainingNetworks}`)
      const prompt: any = await inquirer.prompt([{
        name: 'defaultTo',
        message: 'select the default network to bridge TO (destination network)',
        type: 'list',
        choices: remainingNetworks,
      }])
      defaultTo = prompt.defaultTo
    }

    // Collect private key value
    if (!privateKey) {
      const prompt: any = await inquirer.prompt([{
        name: 'privateKey',
        message: 'Default account to use when sending all transactions',
        type: 'password',
        validate: async (input: string) => {
          try {
            const w = new ethers.Wallet(input)
            this.debug(w)
            return true
          } catch (error) {
            this.debug(error)
            return 'Input is not a valid private key'
          }
        },
      }])
      privateKey = prompt.privateKey
      userWallet = new ethers.Wallet(prompt.privateKey)
    }

    // Collect provider url value
    if (!providerUrl) {
      const prompt: any = await inquirer.prompt([{
        name: 'providerUrl',
        message: 'Enter the provider url',
        type: 'input',
        validate: async (input: string) => {
          if (!this.isStringAValidURL(input)) {
            return 'Input is not a valid and secure URL (https or wss)'
          }

          return true
        },
      }])
      providerUrl = prompt.providerUrl
    }

    // Save config object
    try {
      const userConfigSample = {
        providerUrl: providerUrl,
        network: {
          from: defaultFrom,
          to: defaultTo,
        },
        user: {
          credentials: {
            privateKey: privateKey,
            address: userWallet?.address,
          },
        },
      }
      await fs.outputJSON(configPath, userConfigSample)
    } catch (error: any) {
      this.log('configuration file does not exist, lets create it!')
      this.debug(error)
      this.log(`Failed to save file in ${configPath}. Please try again with debugger on and try again.`)
    }
  }
}
