import * as inquirer from 'inquirer'
import {BigNumber} from 'ethers'
import {ConfigNetworks} from './config'

const addressValidator = /^0x[\da-f]{40}$/i

const numberValidator = /^\d{1,78}$/

const tokenValidator = /^((0x[\da-f]{1,64})|(\d{1,78}))$/i

const validateContractAddress = async (input: string): Promise<string> => {
  const output: string = input.trim().toLowerCase()
  if (addressValidator.test(output)) {
    return output
  }

  throw new Error('Invalid contact address provided ' + output)
}

const validateTokenIdInput = async (input: string): Promise<string> => {
  const output: string = input.trim().toLowerCase()
  if (tokenValidator.test(output)) {
    if (numberValidator.test(output)) {
      return BigNumber.from(output).toHexString()
    }

    return output
  }

  throw new Error('Invalid tokenId provided ' + output)
}

const checkContractAddressFlag = async (input: string | undefined, prompt: string): Promise<string> => {
  if (input === undefined) {
    const contractAddressPrompt: any = await inquirer.prompt([
      {
        name: 'contractAddress',
        message: prompt,
        type: 'string',
        validate: async (input: string) => {
          await validateContractAddress(input)
          return true
        },
      },
    ])
    return validateContractAddress(contractAddressPrompt.contractAddress as string)
  }

  return input as string
}

const checkNetworkFlag = async (networks: ConfigNetworks, input: string | undefined, prompt: string, exclude?: string | undefined): Promise<string> => {
  if (input !== undefined) {
    input = input.trim().toLowerCase()
  }

  let networkList: string[] = Object.keys(networks)
  if (exclude !== undefined) {
    networkList = networkList.filter((element: string) => {
      return !(element === exclude)
    })
  }

  if (input === undefined || (input !== undefined && !networkList.includes(input))) {
    const networkPrompt: any = await inquirer.prompt([
      {
        name: 'network',
        message: prompt,
        type: 'list',
        choices: networkList,
      },
    ])
    return networkPrompt.network as string
  }

  return input as string
}

const checkTokenIdFlag = async (input: string | undefined, prompt: string): Promise<string> => {
  if (input === undefined) {
    const tokenIdPrompt: any = await inquirer.prompt([
      {
        name: 'tokenId',
        message: prompt,
        type: 'string',
        validate: async (input: string) => {
          await validateTokenIdInput(input)
          return true
        },
      },
    ])
    return validateTokenIdInput(tokenIdPrompt.tokenId as string)
  }

  return input as string
}

export {addressValidator, numberValidator, tokenValidator, validateContractAddress, validateTokenIdInput, checkContractAddressFlag, checkNetworkFlag, checkTokenIdFlag}
