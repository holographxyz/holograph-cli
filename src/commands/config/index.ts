import {Command, Flags} from '@oclif/core'
import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import * as path from 'node:path'
import {ethers} from 'ethers'
import {
  checkFileExists,
  ensureConfigFileIsValid,
  isFromAndToNetworksTheSame,
  isStringAValidURL,
  randomASCII,
  CONFIG_FILE_NAME, validateBeta1Schema,
} from '../../utils/config'
import AesEncryption from '../../utils/aes-encryption'

export default class Config extends Command {
  static description =
    'Initialize the Holo command line to become an operator or to bridge collections and NFTs manually'

  static examples = [
    '$ holo --defaultFrom rinkeby',
    '$ holo --defaultFrom rinkeby --defaultTo mumbai',
    '$ holo --privateKey abc...def',
    '$ holo --fromFile ./config.json',
    '$ holo --fromJson \'{"version": "beta1", ...}',
  ]

  static supportedNetworks = ['rinkeby', 'mumbai', 'fuji']

  static flags = {
    defaultFrom: Flags.string({
      options: this.supportedNetworks,
      description: 'Default network to bridge FROM (source network)',
    }),
    defaultTo: Flags.string({
      options: this.supportedNetworks,
      description: 'Default network to bridge TO (destination network)',
    }),
    network: Flags.string({
      options: this.supportedNetworks,
      description: 'Network to set',
    }),
    url: Flags.string({
      description: 'Provider URL of network to set',
      dependsOn: ['network'],
    }),
    privateKey: Flags.string({description: 'Default account to use when sending all transactions'}),
    fromFile: Flags.string({description: 'Location of file to load config'}),
    fromJson: Flags.string({description: 'JSON object to use as the config'}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Config)
    let defaultFrom = flags.defaultFrom
    let defaultTo = flags.defaultTo
    let privateKey = flags.privateKey
    let userWallet = null
    let currentConfigFile: any = null
    let encryption
    let iv = ''
    const loadConfigPath = flags.fromFile
    const loadConfigJson = flags.fromJson

    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    this.debug(`Configuration path ${configPath}`)

    let updateNetworksPrompt = {update: false}
    let privateKeyPrompt: any = {update: false}

    // Check if config Dir flag is empty
    if(typeof loadConfigPath !== 'undefined') {
      try {
        const stats = fs.lstatSync(loadConfigPath)
        this.debug(`Is file: ${stats.isFile()}`);
        this.debug(`Is directory: ${stats.isDirectory()}`);
        this.debug(`Is symbolic link: ${stats.isSymbolicLink()}`);
        this.debug(`Is FIFO: ${stats.isFIFO()}`);
        this.debug(`Is socket: ${stats.isSocket()}`);
        this.debug(`Is character device: ${stats.isCharacterDevice()}`);
        this.debug(`Is block device: ${stats.isBlockDevice()}`);

        if(stats.isFile() && !stats.isDirectory() && !stats.isSymbolicLink() && !stats.isFIFO() && !stats.isSocket() && !stats.isCharacterDevice() && !stats.isBlockDevice()) {
          const ensureCheck = await ensureConfigFileIsValid(loadConfigPath)

          // Since the json at the desired path is valid, we save it!
          await fs.outputJSON(configPath, ensureCheck.configFile, {spaces: 2})

          // this.exit() // NOTE: for some reason this.exits only exits the current try catch block.
        } else {
          this.error(`loadConfigPath is NOT VALID FAIL`)
        }
      } catch (error: any) {
        // Handle error
        if(error.code === 'ENOENT'){
          this.error(`The input ${loadConfigPath} is not a valid file path`)
          // eslint-disable-next-line no-negated-condition
        } else if (typeof error.message !== 'undefined') {
          this.error(error.message)
        } else {
          this.error(`Failed to load ${loadConfigPath}`)
        }

        this.exit()
      }

      this.exit()
    }

    // Check if config Json flag is empty
    if(typeof loadConfigJson !== 'undefined') {
      this.log(`checking loadConfigJson input`)
      const output = JSON.parse(loadConfigJson)
      await validateBeta1Schema(output)
      this.log(output)
      // Since the json at the desired path is valid, we save it!
      await fs.outputJSON(configPath, output, {spaces: 2})
      this.exit(0)
    }

    // Make sure default from and to networks are not the same when using flags
    if (typeof defaultFrom !== 'undefined' && typeof defaultTo !== 'undefined') {
      const isValidFromAndTo = isFromAndToNetworksTheSame(defaultFrom, defaultTo)
      if (!isValidFromAndTo) {
        this.log('The FROM and TO networks cannot be the same')
        this.error('Networks cannot be the same')
      }
    }

    // Check if config file exists
    const isConfigExist: boolean = await checkFileExists(configPath)

    let userConfigTemplate: any = {
      version: 'beta1',
      bridge: {
        source: defaultFrom,
        destination: defaultTo,
      },
      networks: {},
      user: {
        credentials: {
          iv: iv,
          privateKey: privateKey,
          address: '',
        },
      },
    }

    if (isConfigExist) {
      this.log(`Updating existing configuration file at ${configPath}`)
      currentConfigFile = await ensureConfigFileIsValid(configPath)
      userConfigTemplate = Object.assign({}, userConfigTemplate, currentConfigFile.configFile)

      const prompt: any = await inquirer.prompt([
        {
          name: 'shouldContinue',
          message: 'Configuration already exist, are you sure you want to override existing values?',
          type: 'confirm',
          default: false,
        },
      ])
      if (!prompt.shouldContinue) {
        this.log('No files were modified')
        this.exit()
      }
    } else {
      this.log(`Creating a new config file file at ${configPath}`)
    }

    if (isConfigExist) {
      // See if the user wants to update network config
      updateNetworksPrompt = await inquirer.prompt([
        {
          name: 'update',
          message: 'Would you like to update your network config?',
          type: 'confirm',
          default: false,
        },
      ])
    }

    if (updateNetworksPrompt.update || !isConfigExist) {
      // Array will get smaller depending on input defaultFrom and defaultTo values. I copy value so I can manipulate it
      let remainingNetworks = Config.supportedNetworks
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
            message: 'Select the default network to bridge FROM (source network)',
            type: 'list',
            choices: remainingNetworks,
          },
        ])
        defaultFrom = prompt.defaultFrom
      }

      // Collect default TO network value
      if (defaultTo === undefined) {
        remainingNetworks = remainingNetworks.filter((item: string) => {
          return item !== defaultFrom
        })
        this.debug(`remainingNetworks = ${remainingNetworks}`)
        const prompt: any = await inquirer.prompt([
          {
            name: 'defaultTo',
            message: 'Select the default network to bridge TO (destination network)',
            type: 'list',
            choices: remainingNetworks,
          },
        ])
        defaultTo = prompt.defaultTo
      }

      // Update user config with new defaultFrom and defaultTo values
      userConfigTemplate.bridge.source = defaultFrom
      userConfigTemplate.bridge.destination = defaultTo

      // Check what networks the user wants to operate on
      const prompt: any = await inquirer.prompt([
        {
          type: 'checkbox',

          name: 'networks',
          message: 'Which networks do you want to operate?',
          choices: Config.supportedNetworks,
          validate: async (input: any) => {
            if (input.length >= 2) {
              return true
            }

            return 'Please select at least 2 networks to operate on. Use the arrow keys and spacebar to select.'
          },
        },
      ])
      const networks = prompt.networks

      // Remove networks the user doesn't want to operate on
      for (const network of Object.keys(userConfigTemplate.networks)) {
        if (!networks.includes(network)) {
          delete userConfigTemplate.networks[network]
        }
      }

      // Add networks to the user config
      // It's okay to await in loop because this is a synchronous operation
      /* eslint-disable no-await-in-loop */
      for (const network of networks) {
        const prompt: any = await inquirer.prompt([
          {
            name: 'providerUrl',
            message: `Enter the provider url for ${network}. Leave blank to keep current provider.`,
            type: 'input',
            validate: async (input: string) => {
              if (isStringAValidURL(input) || (input === '' && isConfigExist)) {
                return true
              }

              return 'Input is not a valid and secure URL (https or wss)'
            },
          },
        ])

        // Leave existing providerUrl if user didn't enter a new one
        if (prompt.providerUrl !== '') {
          userConfigTemplate.networks[network] = {providerUrl: prompt.providerUrl}
        }
      }
    }

    if (isConfigExist) {
      // See if the user wants to update network config
      privateKeyPrompt = await inquirer.prompt([
        {
          name: 'update',
          message: 'Would you like to update your private key?',
          type: 'confirm',
          default: false,
        },
      ])
    }

    if (privateKeyPrompt.update || !isConfigExist) {
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
                // We need to check that key decoded
                userWallet = new ethers.Wallet(
                  encryption.decrypt(currentConfigFile.user.credentials.privateKey) as string,
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

      userConfigTemplate.user.credentials.iv = iv
      userConfigTemplate.user.credentials.privateKey = privateKey
      userConfigTemplate.user.credentials.address = userWallet?.address
    }

    // Save config object
    try {
      await fs.outputJSON(configPath, userConfigTemplate, {spaces: 2})
    } catch (error: any) {
      this.log(`Failed to save file in ${configPath}. Please enable debugger and try again.`)
      this.debug(error)
    }

    this.exit()
  }
}
