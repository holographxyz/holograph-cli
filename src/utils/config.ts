import * as path from 'node:path'
import * as fs from 'fs-extra'
import * as inquirer from 'inquirer'
import * as Joi from 'joi'
import {ethers} from 'ethers'

import AesEncryption from './aes-encryption'

export const CONFIG_FILE_NAME = 'config.json'

export interface ConfigNetwork {
  name: string
  providerUrl: string
}

export interface ConfigBridge {
  source: string
  destination: string
}

export interface ConfigNetworks {
  rinkeby: ConfigNetwork
  fuji: ConfigNetwork
  mumbai: ConfigNetwork
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

async function tryToUnlockWallet(
  configFile: ConfigFile,
  unlockWallet: boolean,
  unsafePassword: string | undefined,
): Promise<ethers.Wallet> {
  let userWallet: ethers.Wallet | undefined
  if (unlockWallet) {
    // eslint-disable-next-line no-negated-condition
    if (typeof unsafePassword !== 'undefined') {
      try {
        userWallet = new ethers.Wallet(
          new AesEncryption(unsafePassword, configFile.user.credentials.iv).decrypt(
            configFile.user.credentials.privateKey,
          ),
        )
      } catch {
        throw new Error('password provided for wallet in holo config is not correct')
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

export async function ensureConfigFileIsValid(
  configDir: string,
  unsafePassword: string | undefined,
  unlockWallet = false,
): Promise<{userWallet: ethers.Wallet; configFile: ConfigFile}> {
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
    throw new Error('Please run `holo config` before running any other holo command')
  }

  try {
    const configFile = await fs.readJson(configPath)
    await validateBeta1Schema(configFile)
    const userWallet: ethers.Wallet = await tryToUnlockWallet(configFile as ConfigFile, unlockWallet, unsafePassword)

    return {userWallet, configFile}
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
      rinkeby: Joi.object({
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
