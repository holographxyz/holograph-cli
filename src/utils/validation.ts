import {BigNumber} from 'ethers'

const addressValidator = /^0x[\da-f]{40}$/i

const numberValidator = /^\d{1,78}$/i

const tokenValidator = /^((0x[\da-f]{1,64})|(\d{1,78}))$/i

const validateContractAddress = async (input: string): Promise<string> => {
  const output: string = input.trim().toLowerCase()
  if (addressValidator.test(output)) {
    return output
  }

  throw new Error('Invalid contact address provided ' + output)
}

const validateTokenIdInput = async (input: string): Promise<string> => {
  const output: string = input.trim()
  if (tokenValidator.test(output)) {
    if (numberValidator.test(output)) {
      return BigNumber.from(output).toHexString()
    }

    return output
  }

  throw new Error('Invalid tokenId provided ' + output)
}

export {addressValidator, numberValidator, tokenValidator, validateContractAddress, validateTokenIdInput}
