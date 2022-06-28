import * as fs from 'fs-extra'
import * as Joi from 'joi'

export const CONFIG_FILE_NAME = 'config.json'

export async function ensureConfigFileIsValid(configPath: string): Promise<any> {
  const exists = await fs.pathExists(configPath)
  if (!exists) {
    throw new Error('Please run `holo init` before running any other holo command')
  }

  try {
    const configFile = await fs.readJson(configPath)
    await validateBeta1Schema(configFile)
    return configFile
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
        privateKey: Joi.string(),
        address: Joi.string(),
      }),
    }),
  }).unknown(false)

  await beta1Schema.validateAsync(config)
}
