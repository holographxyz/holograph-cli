import * as fs from 'fs-extra'
import * as inquirer from 'inquirer'
import * as Joi from 'joi'
import { ethers } from 'ethers'

import AesEncryption from './aes-encryption'

export const CONFIG_FILE_NAME = 'config.json'

export async function ensureConfigFileIsValid(configPath: string, unlockWallet = false): Promise<any> {
  const exists = await fs.pathExists(configPath)
  if (!exists) {
    throw new Error('Please run `holo init` before running any other holo command')
  }

  try {
    const configFile = await fs.readJson(configPath)
    await validateBeta1Schema(configFile)
    let userWallet = null
    if (unlockWallet) {
      try {
        userWallet = new ethers.Wallet((new AesEncryption('', configFile.user.credentials.iv)).decrypt(configFile.user.credentials.privateKey))
      } catch {
        await inquirer.prompt([
          {
            name: 'encryptionPassword',
            message: 'Please enter the password to decrypt the private key for ' + configFile.user.credentials.address,
            type: 'password',
            validate: async (input: string) => {
              try {
                // we need to check that key decoded
                userWallet = new ethers.Wallet((new AesEncryption(input, configFile.user.credentials.iv)).decrypt(configFile.user.credentials.privateKey))
                return true
              } catch {
                return 'Password is incorrect'
              }
            },
          },
        ])
      }
    }

    return { userWallet, configFile }
  } catch {
    throw new Error('Config file is no longer valid, please delete it before continuing')
  }
}

export async function validateBeta1Schema(config: any): Promise<any> {
  const beta1Schema = Joi.object({
    version: Joi.string().valid('beta1'),
    network: Joi.object({
      from: Joi.string(),
      to: Joi.string(),
      rinkeby: Joi.object({
        providerUrl: Joi.string(),
      }),
      mumbai: Joi.object({
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
