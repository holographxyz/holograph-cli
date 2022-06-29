import {Command, Flags} from '@oclif/core'
import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import * as path from 'node:path'
import {ethers} from 'ethers'
import {CONFIG_FILE_NAME, ensureConfigFileIsValid, randomASCII} from '../../utils/config'
import AesEncryption from '../../utils/aes-encryption'

export default class Init extends Command {
  static description =
    'Initialize the Holo command line to become an operator or to bridge collections and NFTs manually'

  static examples = [
    '$ holo --defaultFrom rinkeby',
    '$ holo --defaultFrom rinkeby --defaultTo mumbai',
    '$ holo --privateKey abc...def',
    '$ holo --providerUrl https://rpc.com',
    '$ holo --providerUrl wss://rpc.com',
  ]

  static allowedNetworks = ['rinkeby', 'mumbai']

  static flags = {
    defaultFrom: Flags.string({
      options: this.allowedNetworks,
      description: 'Default network to bridge FROM (origin network)',
    }),
    defaultTo: Flags.string({
      options: this.allowedNetworks,
      description: 'Default network to bridge TO (destination network)',
    }),
    privateKey: Flags.string({description: 'Default account to use when sending all transactions'}),
    providerUrlFrom: Flags.string({description: 'Provide a secure https or wss url'}),
    providerUrlTo: Flags.string({description: 'Provide a secure https or wss url'}),
  }

  private async checkFileExists(configPath: string) {
    try {
      return await fs.pathExists(configPath)
    } catch (error) {
      this.debug(error)
      this.error('failed to find config file')
    }
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

  public isFromAndToNetworksTheSame(from: string | undefined, to: string | undefined): boolean {
    return from !== to
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Init)

    let defaultFrom = flags.defaultFrom
    let defaultTo = flags.defaultTo
    let privateKey = flags.privateKey
    let providerUrlFrom = flags.providerUrlFrom
    let providerUrlTo = flags.providerUrlTo
    let userWallet = null
    let currentConfigFile: any = null
    let encryption
    let iv: string

    // Make sure default from and to networks are not the same when using flags
    if (typeof defaultFrom !== 'undefined' && typeof defaultTo !== 'undefined') {
      const isValidFromAndTo = this.isFromAndToNetworksTheSame(defaultFrom, defaultTo)
      if (!isValidFromAndTo) {
        this.log('The FROM and TO networks cannot be the same')
        this.error('Networks cannot be the same')
      }
    }

    // Check if config file exists
    const configFileName = CONFIG_FILE_NAME
    const configPath = path.join(this.config.configDir, configFileName)
    this.debug(`configuration path ${configPath}`)
    const isConfigExist: boolean = await this.checkFileExists(configPath)
    this.debug(`configuration file exists = ${isConfigExist}`)

    if (isConfigExist) {
      currentConfigFile = await ensureConfigFileIsValid(configPath)

      const prompt: any = await inquirer.prompt([
        {
          name: 'shouldContinue',
          message: 'configuration already exist, are you sure you want to override existing values?',
          type: 'confirm',
          default: false,
        },
      ])
      if (!prompt.shouldContinue) {
        this.error('No files were modified')
      }
    }

    // Array will get smaller depending on input defaultFrom and defaultTo values. I copy value so I can manipulate it
    let remainingNetworks = Init.allowedNetworks
    this.debug(`remainingNetworks = ${remainingNetworks}`)

    // Collect default FROM network value
    if (defaultFrom === undefined) {
      remainingNetworks = remainingNetworks.filter((item: string) => {
        return item !== defaultTo
      })
      this.debug(`remainingNetworks = ${remainingNetworks}`)
      const prompt: any = await inquirer.prompt([
        {
          name: 'defaultFrom',
          message: 'select the default network to bridge FROM (origin network)',
          type: 'list',
          choices: remainingNetworks,
        },
      ])
      defaultFrom = prompt.defaultFrom
    }

    // Collect default TO network value
    if (!defaultTo) {
      remainingNetworks = remainingNetworks.filter((item: string) => {
        return item !== defaultFrom
      })
      this.debug(`remainingNetworks = ${remainingNetworks}`)
      const prompt: any = await inquirer.prompt([
        {
          name: 'defaultTo',
          message: 'select the default network to bridge TO (destination network)',
          type: 'list',
          choices: remainingNetworks,
        },
      ])
      defaultTo = prompt.defaultTo
    }

    // Collect private key value
    let keyProtected = true
    if (privateKey === undefined) {
      keyProtected = false
      const prompt: any = await inquirer.prompt([
        {
          name: 'privateKey',
          message: 'Default private key to use when sending all transactions (will be password encrypted)',
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
        },
      ])
      privateKey = prompt.privateKey
      userWallet = new ethers.Wallet(prompt.privateKey)
      iv = randomASCII(12)
    } else {
      iv = currentConfigFile.user.credentials.iv
    }

    await inquirer.prompt([
      {
        name: 'encryptionPassword',
        message: 'Please enter the password to ' + (keyProtected ? 'decrypt' : 'encrypt') + ' the private key with',
        type: 'password',
        validate: async (input: string) => {
          try {
            encryption = new AesEncryption(input, iv)
            if (keyProtected) {
              // we need to check that key decoded
              userWallet = new ethers.Wallet(
                encryption.decrypt(currentConfigFile.user.credentials.privataKey) as string,
              )
            } else {
              privateKey = encryption.encrypt(privateKey || '')
            }

            return true
          } catch (error) {
            this.debug(error)
            return 'Input is not a valid password'
          }
        },
      },
    ])

    // Collect provider url value, from network
    if (!providerUrlFrom) {
      const prompt: any = await inquirer.prompt([
        {
          name: 'providerUrlFrom',
          message: 'Enter the FROM (origin) provider url',
          type: 'input',
          validate: async (input: string) => {
            if (!this.isStringAValidURL(input)) {
              return 'Input is not a valid and secure URL (https or wss)'
            }

            return true
          },
        },
      ])
      providerUrlFrom = prompt.providerUrlFrom
    }

    // Collect provider url value, to network
    if (!providerUrlTo) {
      const prompt: any = await inquirer.prompt([
        {
          name: 'providerUrlTo',
          message: 'Enter the TO (destination) provider url',
          type: 'input',
          validate: async (input: string) => {
            if (!this.isStringAValidURL(input)) {
              return 'Input is not a valid and secure URL (https or wss)'
            }

            return true
          },
        },
      ])
      providerUrlTo = prompt.providerUrlTo
    }

    // Save config object
    try {
      const userConfigSample = {
        version: 'beta1',
        network: {
          from: defaultFrom,
          to: defaultTo,
          // NOTE: The defaultTo and DefaultFrom can be in any order
          // I dynamically set the key name, and ts does not like it
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          [defaultFrom]: {
            providerUrl: providerUrlFrom,
          },
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          [defaultTo]: {
            providerUrl: providerUrlTo,
          },
        },
        user: {
          credentials: {
            iv: iv,
            privateKey: privateKey,
            address: userWallet?.address,
          },
        },
      }
      await fs.outputJSON(configPath, userConfigSample)
    } catch (error: any) {
      this.log(`Failed to save file in ${configPath}. Please try again with debugger on and try again.`)
      this.debug(error)
    }

    userWallet = undefined
  }
}
