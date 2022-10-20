import {JsonRpcProvider, StaticJsonRpcProvider, TransactionReceipt, Web3Provider} from '@ethersproject/providers'
import {BigNumberish, Contract} from 'ethers'
import CoreChainService from './CoreChainService'

class OperatorChainService extends CoreChainService {
  operator: Contract
  constructor(
    library: JsonRpcProvider | StaticJsonRpcProvider | Web3Provider,
    chainId: SupportedChainIds,
    contract: Contract,
  ) {
    super(library, chainId)
    this.operator = contract
  }

  getPodOperators = async (pod: number): Promise<String[]> => {
    return this.operator.getPodOperators(pod)
  }

  getPodBondAmounts = async (pod: number): Promise<{base: BigNumberish; current: BigNumberish}> => {
    return this.operator.getPodBondAmounts(pod)
  }

  getBondedPod = async (operator: string): Promise<BigNumberish> => {
    return this.operator.getBondedPod(operator)
  }

  getTotalPods = async (): Promise<BigNumberish> => {
    return this.operator.getTotalPods()
  }

  getBondedAmount = async (account: string): Promise<BigNumberish> => {
    return this.operator.getBondedAmount(account)
  }

  bondUtilityToken = async (operator: string, amount: BigNumberish, pod: number): Promise<TransactionReceipt> => {
    const tx = await this.operator.bondUtilityToken(operator, amount, pod)
    await tx.wait()
    return tx
  }

  getBondUtilityTokenFee = async (operator: string, amount: BigNumberish, pod: number): Promise<GasFee> => {
    const gasPrice = await this.getChainGasPrice()
    const gasLimit = await this.operator.estimateGas.bondUtilityToken(operator, amount, pod)

    return {
      gas: gasPrice.mul(gasLimit),
      gasPrice,
      gasLimit,
    }
  }

  unbondUtilityToken = async (operator: string, receiver: string): Promise<TransactionReceipt> => {
    const tx = await this.operator.unbondUtilityToken(operator, receiver)
    await tx.wait()
    return tx
  }

  getUnbondUtilityTokenFee = async (operator: string, receiver: string): Promise<GasFee> => {
    const gasPrice = await this.getChainGasPrice()
    const gasLimit = await this.operator.estimateGas.unbondUtilityToken(operator, receiver)

    return {
      gas: gasPrice.mul(gasLimit),
      gasPrice,
      gasLimit,
    }
  }
}

export default OperatorChainService
