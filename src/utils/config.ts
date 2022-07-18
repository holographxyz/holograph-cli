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
  origin: string
  destination: string
}

export interface ConfigNetworks {
  rinkeby: ConfigNetwork
  mumbai: ConfigNetwork
  fuji: ConfigNetwork
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

export async function ensureConfigFileIsValid(
  configPath: string,
  unlockWallet = false,
): Promise<{userWallet: ethers.Wallet | undefined; configFile: ConfigFile}> {
  const exists = await fs.pathExists(configPath)
  if (!exists) {
    throw new Error('Please run `holo config` before running any other holo command')
  }

  try {
    const configFile = await fs.readJson(configPath)
    await validateBeta1Schema(configFile)
    let userWallet
    if (unlockWallet) {
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

    return {userWallet, configFile}
  } catch (error: any) {
    throw new Error(`Config file is no longer valid, please delete it before continuing ${error.message}`)
  }
}

export async function validateBeta1Schema(config: Record<string, unknown>): Promise<void> {
  const beta1Schema = Joi.object({
    version: Joi.string().valid('beta1'),
    bridge: {
      origin: Joi.string(),
      destination: Joi.string(),
    },
    networks: Joi.object({
      rinkeby: Joi.object({
        providerUrl: Joi.string(),
      }),
      mumbai: Joi.object({
        providerUrl: Joi.string(),
      }),
      fuji: Joi.object({
        providerUrl: Joi.string(),
      }),
    }),
    user: Joi.object({
      credentials: Joi.object({
        iv: Joi.string(),
        privateKey: Joi.string(),
        address: Joi.string(),
      }),
    }),
  }).unknown(false)

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
