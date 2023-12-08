import * as path from 'node:path'
import * as fs from 'fs-extra'
import * as inquirer from 'inquirer'
import * as Joi from 'joi'

import {Wallet} from '@ethersproject/wallet'
import {Environment, getEnvironment} from '@holographxyz/environment'
import {NetworkKeys, supportedNetworks, networks} from '@holographxyz/networks'

import AesEncryption from './aes-encryption'
import {SelectOption} from './validation'

export const CONFIG_FILE_NAME = 'config.json'

export interface ConfigNetwork {
  providerUrl: string
}

export interface ConfigNetworks {
  [k: NetworkKeys]: ConfigNetwork
}

export interface ConfigCredentials {
  iv: string
  privateKey: string
  address: string
}

export interface ConfigUser {
  credentials: ConfigCredentials
}

export interface ConfigFile {
  version: string
  networks: ConfigNetworks
  user: ConfigUser
}

export enum BlockProcessingVersion {
  V1 = 'V1',
  V2 = 'V2',
}

export function getBlockProcessingVersion() {
  const blockProcessingVersionEnv = process.env.BLOCK_PROCESSING_VERSION?.toUpperCase() ?? ''

  if (!(blockProcessingVersionEnv in BlockProcessingVersion)) {
    console.warn('BLOCK_PROCESSING_VERSION value is not valid, using default version: V2')
  }

  switch (blockProcessingVersionEnv) {
    case 'V1':
      return BlockProcessingVersion.V1
    case 'V2':
      return BlockProcessingVersion.V2
    default:
      return BlockProcessingVersion.V2
  }
}

const localhostConfig: ConfigFile = {
  version: 'beta3',
  networks: {localhost: {providerUrl: 'http://localhost:8545'}, localhost2: {providerUrl: 'http://localhost:9545'}},
  user: {
    credentials: {
      iv: 'n6QP9:_vn=})',
      privateKey:
        'QDiDSbP9O0C58wm9rj41D1jqGgYT4+XBMuO6e8R1gc53IzbxKrHAjVeALxkSCkcFIx7MerWm4+ZVbJ0n51FbIPYz6OpnKRXXFGtDLq64mgU=',
      address: '0xdf5295149F367b1FBFD595bdA578BAd22e59f504',
    },
  },
}

async function tryToUnlockWallet(
  configFile: ConfigFile,
  unlockWallet: boolean,
  unsafePassword?: string,
): Promise<Wallet> {
  let userWallet: Wallet | undefined
  if (unlockWallet) {
    // eslint-disable-next-line no-negated-condition
    if (unsafePassword !== undefined) {
      try {
        userWallet = new Wallet(
          new AesEncryption(unsafePassword, configFile.user.credentials.iv).decrypt(
            configFile.user.credentials.privateKey,
          ),
        )
      } catch {
        throw new Error('password provided for wallet in holograph config is not correct')
      }
    } else {
      try {
        userWallet = new Wallet(
          new AesEncryption('', configFile.user.credentials.iv).decrypt(configFile.user.credentials.privateKey),
        )
      } catch {
        await inquirer.prompt([
          {
            name: 'encryptionPassword',
            message: 'Please enter the password to decrypt the private key for ' + configFile.user.credentials.address,
            type: 'password',
            validate: async (input: string) => {
              try {
                // we need to check that key decoded
                userWallet = new Wallet(
                  new AesEncryption(input, configFile.user.credentials.iv).decrypt(
                    configFile.user.credentials.privateKey,
                  ),
                )
                return true
              } catch {
                return 'Password is incorrect'
              }
            },
          },
        ])
      }
    }

    if (userWallet === undefined) {
      throw new Error('Wallet could not be unlocked')
    }
  }

  return userWallet as Wallet
}

export function generateSupportedNetworksOptions(configNetworks?: ConfigNetworks): SelectOption[] {
  const options: SelectOption[] = []
  for (const key of supportedNetworks) {
    if (configNetworks === undefined) {
      options.push({name: networks[key].shortKey, value: networks[key].key} as SelectOption)
    } else if (key in configNetworks) {
      options.push({name: networks[key].shortKey, value: networks[key].key} as SelectOption)
    }
  }

  return options
}

export async function ensureConfigFileIsValid(
  configDir: string,
  unsafePassword: string | undefined,
  unlockWallet = false,
): Promise<{
  environment: Environment
  userWallet: Wallet
  configFile: ConfigFile
  supportedNetworksOptions: SelectOption[]
}> {
  const environment: Environment = getEnvironment()
  if (environment === Environment.localhost) {
    process.stdout.write(`\n👉 Environment: ${environment}\n\n`)
    return {
      environment,
      userWallet: await tryToUnlockWallet(localhostConfig, unlockWallet),
      configFile: localhostConfig,
      supportedNetworksOptions: generateSupportedNetworksOptions(),
    }
  }

  let configPath = configDir
  try {
    await fs.pathExists(configDir)
    const stats = await fs.stat(configDir)
    if (!stats.isFile()) {
      throw new Error('The configDir is a directory and not a file')
    }
  } catch {
    configPath = path.join(configDir, CONFIG_FILE_NAME)
    // console.debug('configPath', configPath)
  }

  const exists = await fs.pathExists(configPath)
  if (!exists) {
    throw new Error('Please run `holograph config` before running any other holograph command')
  }

  try {
    const configFile = await fs.readJson(configPath)

    const result = validateBeta3Schema(configFile)
    if (result.error) {
      throw new Error(`Configuration Validation Check: ${result.error.message}`)
    }

    const userWallet: Wallet = await tryToUnlockWallet(configFile as ConfigFile, unlockWallet, unsafePassword)

    process.stdout.write(`\n👉 Environment: ${environment}\n\n`)
    return {
      environment,
      userWallet,
      configFile,
      supportedNetworksOptions: generateSupportedNetworksOptions(configFile.networks),
    }
  } catch (error: any) {
    throw error.message
      ? error
      : new Error(`Config file is no longer valid, please delete it before continuing ${error.message}`)
  }
}

export function validateBeta3Schema(config: Record<string, unknown>): Joi.ValidationResult<any> {
  const networkObjects: {[k: string]: any} = {} as {[k: string]: any}
  for (const network of supportedNetworks) {
    networkObjects[network] = Joi.object({
      providerUrl: Joi.string(),
    })
  }

  const beta3Schema = Joi.object({
    version: Joi.string().valid('beta3').required(),
    networks: Joi.object(networkObjects).required().unknown(false),
    user: Joi.object({
      credentials: Joi.object({
        iv: Joi.string(),
        privateKey: Joi.string().required(),
        address: Joi.string().required(),
      }).required(),
    }).required(),
  })
    .required()
    .unknown(false)

  return beta3Schema.validate(config, {abortEarly: false})
}

export async function checkFileExists(configPath: string): Promise<boolean> {
  try {
    return await fs.pathExists(configPath)
  } catch (error) {
    console.debug(error)
    return false
  }
}

export async function readConfig(configPath: string): Promise<any> {
  try {
    return await fs.readJSON(configPath)
  } catch (error) {
    console.debug(error)
    return undefined
  }
}
