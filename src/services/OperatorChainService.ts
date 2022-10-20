import {JsonRpcProvider, StaticJsonRpcProvider, TransactionReceipt, Web3Provider} from '@ethersproject/providers'
import {BigNumber, Contract} from 'ethers'
import CoreChainService from './CoreChainService'
import {GasFee} from '../types/Interfaces'

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

  getPodBondAmounts = async (pod: number): Promise<{base: BigNumber; current: BigNumber}> => {
    return this.operator.getPodBondAmounts(pod)
  }

  getBondedPod = async (operator: string): Promise<BigNumber> => {
    return this.operator.getBondedPod(operator)
  }

  getTotalPods = async (): Promise<BigNumber> => {
    return this.operator.getTotalPods()
  }

  getBondedAmount = async (account: string): Promise<BigNumber> => {
    return this.operator.getBondedAmount(account)
  }

  bondUtilityToken = async (operator: string, amount: BigNumber, pod: number): Promise<TransactionReceipt> => {
    const tx = await this.operator.bondUtilityToken(operator, amount, pod)
    await tx.wait()
    return tx
  }

  getBondUtilityTokenFee = async (operator: string, amount: BigNumber, pod: number): Promise<GasFee> => {
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
