import * as path from 'node:path'
import * as fs from 'fs-extra'
import * as inquirer from 'inquirer'
import * as Joi from 'joi'
import {ethers} from 'ethers'

import AesEncryption from './aes-encryption'
import {Environment, getEnvironment} from './environment'
import {NetworkType, Network, networks} from '@holographxyz/networks'

export const CONFIG_FILE_NAME = 'config.json'

export interface ConfigNetwork {
  providerUrl: string
}

export interface ConfigBridge {
  source: string
  destination: string
}

export interface ConfigNetworks {
  [k: string]: ConfigNetwork
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
  bridge: ConfigBridge
  networks: ConfigNetworks
  user: ConfigUser
}

const localhostConfig: ConfigFile = {
  version: 'beta1',
  bridge: {source: 'localhost', destination: 'localhost2'},
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
): Promise<ethers.Wallet> {
  let userWallet: ethers.Wallet | undefined
  if (unlockWallet) {
    // eslint-disable-next-line no-negated-condition
    if (unsafePassword !== undefined) {
      try {
        userWallet = new ethers.Wallet(
          new AesEncryption(unsafePassword, configFile.user.credentials.iv).decrypt(
            configFile.user.credentials.privateKey,
          ),
        )
      } catch {
        throw new Error('password provided for wallet in holograph config is not correct')
      }
    } else {
      try {
        userWallet = new ethers.Wallet(
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
                userWallet = new ethers.Wallet(
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

  return userWallet as ethers.Wallet
}

export function getSupportedNetworks(environment?: Environment): string[] {
  if (environment === undefined) {
    environment = getEnvironment()
  }

  const supportedNetworks: string[] = Object.keys(networks).filter((networkKey: string) => {
    const network: Network = networks[networkKey]
    switch (environment) {
      case Environment.localhost:
        if (network.type === NetworkType.local && network.active) {
          return true
        }

        break
      case Environment.experimental:
        if (network.type === NetworkType.testnet && network.active) {
          return true
        }

        break
      case Environment.develop:
        if (network.type === NetworkType.testnet && network.active) {
          return true
        }

        break
      case Environment.testnet:
        if (network.type === NetworkType.testnet && network.active) {
          return true
        }

        break
      case Environment.mainnet:
        if (network.type === NetworkType.mainnet && network.active) {
          return true
        }

        break
    }

    return false
  })
  return supportedNetworks
}

export const supportedNetworks = getSupportedNetworks()

export async function ensureConfigFileIsValid(
  configDir: string,
  unsafePassword: string | undefined,
  unlockWallet = false,
): Promise<{environment: Environment; userWallet: ethers.Wallet; configFile: ConfigFile; supportedNetworks: string[]}> {
  const environment: Environment = getEnvironment()
  if (environment === Environment.localhost) {
    console.log(`Environment=${environment}`)
    return {
      environment,
      userWallet: await tryToUnlockWallet(localhostConfig, unlockWallet),
      configFile: localhostConfig,
      supportedNetworks,
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
    console.log('configPath', configPath)
  }

  const exists = await fs.pathExists(configPath)
  if (!exists) {
    throw new Error('Please run `holograph config` before running any other holograph command')
  }

  try {
    const configFile = await fs.readJson(configPath)
    await validateBeta1Schema(configFile)
    const userWallet: ethers.Wallet = await tryToUnlockWallet(configFile as ConfigFile, unlockWallet, unsafePassword)

    console.log(`Environment=${environment}`)
    return {environment, userWallet, configFile, supportedNetworks}
  } catch (error: any) {
    const error_ = error.message
      ? error
      : new Error(`Config file is no longer valid, please delete it before continuing ${error.message}`)
    throw error_
  }
}

export async function validateBeta1Schema(config: Record<string, unknown>): Promise<void> {
  const beta1Schema = Joi.object({
    version: Joi.string().valid('beta1').required(),
    bridge: Joi.object({
      source: Joi.string().required(),
      destination: Joi.string().required(),
    }).required(),
    networks: Joi.object({
      // eslint-disable-next-line camelcase
      eth_rinkeby: Joi.object({
        providerUrl: Joi.string().required(),
      }),
      // eslint-disable-next-line camelcase
      eth_goerli: Joi.object({
        providerUrl: Joi.string().required(),
      }),
      fuji: Joi.object({
        providerUrl: Joi.string().required(),
      }),
      mumbai: Joi.object({
        providerUrl: Joi.string().required(),
      }),
    }).required(),
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

  await beta1Schema.validateAsync(config)
}

export function randomASCII(bytes: number): string {
  let text = ''
  for (let i = 0; i < bytes; i++) {
    text += (32 + Math.floor(Math.random() * 94)).toString(16).padStart(2, '0')
  }

  return Buffer.from(text, 'hex').toString()
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

export function isStringAValidURL(s: string): boolean {
  const protocols = ['https', 'wss']
  try {
    const result = new URL(s)
    return result.protocol ? protocols.map(x => `${x.toLowerCase()}:`).includes(result.protocol) : false
  } catch {
    return false
  }
}

export function isFromAndToNetworksTheSame(from: string | undefined, to: string | undefined): boolean {
  return from !== to
}
