import * as inquirer from 'inquirer'

import {BigNumber} from '@ethersproject/bignumber'
import {supportedNetworks, supportedShortNetworks, getNetworkByShortKey} from '@holographxyz/networks'

import {BytecodeType} from './bytecodes'
import {ConfigNetworks} from './config'
import {DeploymentType, deploymentProcesses} from './contract-deployment'
import {TokenUriType} from './asset-deployment'
import {remove0x} from './utils'

export interface SelectOption {
  name: string
  value: string
}

export const addressValidator = /^0x[\da-f]{40}$/i

export const bytesValidator = /^0x[\da-f]+$/i

export const nonEmptyStringValidator = /^[\S ]+$/i

export const numberValidator = /^\d{1,78}$/

export const tokenValidator = /^((0x[\da-f]{1,64})|(\d{1,78}))$/i

export const transactionHashValidator = /^0x[\da-f]{64}$/i

export const portValidator = (port: number): boolean => port >= 3000 && port <= 65_535

export const ipfsCidValidator = /^(qm[1-9a-z]{44,}|b[2-7a-z]{58,}|z[1-9a-z]{48,}|f[\da-f]{50,})$/i

export const validateBytes = async (input: string): Promise<string> => {
  const output: string = input.trim().toLowerCase()
  if (bytesValidator.test(output)) {
    return output
  }

  throw new Error('Invalid bytes provided ' + output)
}

export const validateContractAddress = async (input: string): Promise<string> => {
  const output: string = input.trim().toLowerCase()
  if (addressValidator.test(output)) {
    return output
  }

  throw new Error('Invalid contact address provided ' + output)
}

export const validateNetwork = async (input: string): Promise<string> => {
  const output: string = input.trim()
  if (supportedNetworks.includes(output)) {
    return output
  }

  if (supportedShortNetworks.includes(output)) {
    return getNetworkByShortKey(output).key
  }

  throw new Error('Invalid/unsupported network provided ' + output)
}

export const validateNonEmptyNumber = async (input: string): Promise<string> => {
  const output: string = input.trim()
  if (numberValidator.test(output)) {
    return output
  }

  throw new Error('Invalid number provided ' + output)
}

export const validateNonEmptyString = async (input: string): Promise<string> => {
  const output: string = input.trim()
  if (nonEmptyStringValidator.test(output)) {
    return output
  }

  throw new Error('Invalid bytes provided ' + output)
}

export const validateTokenIdInput = async (input: string): Promise<string> => {
  const output: string = input.trim().toLowerCase()
  if (tokenValidator.test(output)) {
    if (numberValidator.test(output)) {
      return '0x' + remove0x(BigNumber.from(output).toHexString()).padStart(64, '0')
    }

    return output
  }

  throw new Error('Invalid tokenId provided ' + output)
}

export const validateTransactionHash = async (input: string): Promise<string> => {
  const output: string = input.trim().toLowerCase()
  if (transactionHashValidator.test(output)) {
    return output
  }

  throw new Error('Invalid transaction hash provided ' + output)
}

export const validateIpfsCid = async (input: string): Promise<string> => {
  const output: string = input.trim().toLowerCase()
  if (ipfsCidValidator.test(output)) {
    return output
  }

  throw new Error('Invalid IPFS CID provided ' + output)
}

export const checkBytecodeFlag = async (input: string | undefined, prompt: string): Promise<string> => {
  if (input === undefined) {
    const bytecodePrompt: any = await inquirer.prompt([
      {
        name: 'bytecode',
        message: prompt,
        type: 'string',
        validate: async (input: string) => {
          await validateBytes(input)
          return true
        },
      },
    ])
    return validateBytes(bytecodePrompt.bytecode as string)
  }

  return input as string
}

export const checkBytecodeTypeFlag = async (
  input: string | undefined,
  prompt: string,
  exclude?: string | undefined,
): Promise<BytecodeType> => {
  if (input !== undefined) {
    input = input.trim()
  }

  let bytecodeTypeList: string[] = Object.values(BytecodeType)
  if (exclude !== undefined) {
    bytecodeTypeList = bytecodeTypeList.filter((element: string) => {
      return !(element === exclude)
    })
  }

  if (input === undefined || (input !== undefined && !bytecodeTypeList.includes(input))) {
    const bytecodeTypePrompt: any = await inquirer.prompt([
      {
        name: 'bytecodeType',
        message: prompt,
        type: 'list',
        choices: bytecodeTypeList,
      },
    ])
    return BytecodeType[bytecodeTypePrompt.bytecodeType as string as keyof typeof BytecodeType]
  }

  return BytecodeType[input as string as keyof typeof BytecodeType]
}

export const checkContractAddressFlag = async (input: string | undefined, prompt: string): Promise<string> => {
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

export const checkDeploymentTypeFlag = async (
  input: string | undefined,
  prompt: string,
  exclude?: string | undefined,
): Promise<DeploymentType> => {
  if (input !== undefined) {
    input = input.trim()
  }

  let deploymentTypeList: string[] = Object.values(DeploymentType)
  if (exclude !== undefined) {
    deploymentTypeList = deploymentTypeList.filter((element: string) => {
      return !(element === exclude)
    })
  }

  if (input === undefined || (input !== undefined && !deploymentTypeList.includes(input))) {
    const deploymentTypePrompt: any = await inquirer.prompt([
      {
        name: 'deploymentType',
        message: prompt,
        type: 'list',
        choices: deploymentProcesses,
      },
    ])
    return DeploymentType[deploymentTypePrompt.deploymentType as string as keyof typeof DeploymentType]
  }

  return DeploymentType[input as string as keyof typeof DeploymentType]
}

export const checkNetworkFlag = async (
  networks: ConfigNetworks,
  input: string | undefined,
  prompt: string,
  exclude?: string | undefined,
): Promise<string> => {
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

export const checkNumberFlag = async (input: string | undefined, prompt: string): Promise<number> => {
  if (input === undefined) {
    const numberPrompt: any = await inquirer.prompt([
      {
        name: 'numberString',
        message: prompt,
        type: 'string',
        validate: async (input: string) => {
          await validateNonEmptyNumber(input)
          return true
        },
      },
    ])
    return Number.parseInt(await validateNonEmptyNumber(numberPrompt.numberString as string), 10)
  }

  return Number.parseInt(input as string, 10)
}

export const checkOptionFlag = async (
  options: (string | SelectOption)[],
  input: string | undefined,
  prompt: string,
  exclude?: string | undefined,
): Promise<string> => {
  if (input !== undefined) {
    input = input.trim()
  }

  let list: (string | SelectOption)[] = [...options]
  if (exclude !== undefined) {
    list = list.filter((element: string | SelectOption) => {
      if (typeof element === 'string') {
        return !(element === exclude)
      }

      return !(element.name === exclude || element.value === exclude)
    })
  }

  if (input === undefined || (input !== undefined && !list.includes(input))) {
    const optionPrompt: any = await inquirer.prompt([
      {
        name: 'option',
        message: prompt,
        type: 'list',
        choices: list,
      },
    ])
    return optionPrompt.option as string
  }

  return input as string
}

export const checkStringFlag = async (input: string | undefined, prompt: string): Promise<string> => {
  if (input === undefined) {
    const stringPrompt: any = await inquirer.prompt([
      {
        name: 'inputString',
        message: prompt,
        type: 'string',
        validate: async (input: string) => {
          await validateNonEmptyString(input)
          return true
        },
      },
    ])
    return validateNonEmptyString(stringPrompt.inputString as string)
  }

  return input as string
}

export const checkTokenIdFlag = async (input: string | undefined, prompt: string): Promise<string> => {
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

export const checkTokenUriTypeFlag = async (
  input: string | undefined,
  prompt: string,
  exclude?: string | undefined,
): Promise<TokenUriType> => {
  if (input !== undefined) {
    input = input.trim()
  }

  let tokenUriTypeList: string[] = Object.values(TokenUriType)
  if (exclude !== undefined) {
    tokenUriTypeList = tokenUriTypeList.filter((element: string) => {
      return !(element === exclude)
    })
  }

  if (input === undefined || (input !== undefined && !tokenUriTypeList.includes(input))) {
    const tokenUriTypePrompt: any = await inquirer.prompt([
      {
        name: 'tokenUriType',
        message: prompt,
        type: 'list',
        choices: tokenUriTypeList,
      },
    ])
    return TokenUriType[tokenUriTypePrompt.tokenUriType as string as keyof typeof TokenUriType]
  }

  return TokenUriType[input as string as keyof typeof TokenUriType]
}

export const checkTransactionHashFlag = async (input: string | undefined, prompt: string): Promise<string> => {
  if (input === undefined) {
    const transactionHashPrompt: any = await inquirer.prompt([
      {
        name: 'transactionHash',
        message: prompt,
        type: 'string',
        validate: async (input: string) => {
          await validateTransactionHash(input)
          return true
        },
      },
    ])
    return validateTransactionHash(transactionHashPrompt.transactionHash as string)
  }

  return input as string
}

export const getIpfsCidFromTokenUri = (tokenURI: string): string => {
  return (
    tokenURI.match(
      'Qm[1-9A-HJ-NP-Za-km-z]{44,}|b[A-Za-z2-7]{58,}|B[A-Z2-7]{58,}|z[1-9A-HJ-NP-Za-km-z]{48,}|F[0-9A-F]{50,}',
    )?.[0] || ''
  )
}
