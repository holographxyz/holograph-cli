import {TransactionReceipt} from '@ethersproject/providers'
import {Contract} from '@ethersproject/contracts'
import {BigNumber, BigNumberish} from '@ethersproject/bignumber'

import CoreChainService from './core-chain-service'
import {NetworkMonitor} from '../utils/network-monitor'

class OperatorChainService extends CoreChainService {
  operator: Contract
  constructor(network: string, networkMonitor: NetworkMonitor, contract: Contract) {
    super(network, networkMonitor)
    this.operator = contract
  }

  getPodOperators = async (pod: number): Promise<string[]> => {
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

  unbondUtilityToken = async (receiver?: string): Promise<TransactionReceipt | null> => {
    if (receiver === undefined) {
      receiver = this.wallet.address
    }

    return this.networkMonitor.executeTransaction({
      network: this.network,
      contract: this.operator,
      methodName: 'unbondUtilityToken',
      args: [this.wallet.address, receiver],
      waitForReceipt: true,
    })
  }

  bondUtilityToken = async (
    operator: string,
    amount: BigNumberish,
    pod: number,
  ): Promise<TransactionReceipt | null> => {
    return this.networkMonitor.executeTransaction({
      network: this.network,
      contract: this.operator,
      methodName: 'bondUtilityToken',
      args: [operator, amount, pod],
      waitForReceipt: true,
    })
  }

  estimateGasForBondUtilityToken = async (operator: string, amount: BigNumberish, pod: number): Promise<BigNumber> => {
    const gasPrice: BigNumber = this.getChainGasPrice()
    const gasLimit = await this.networkMonitor.getGasLimit({
      contract: this.operator,
      methodName: 'bondUtilityToken',
      args: [operator, amount, pod],
      network: this.network,
      gasPrice,
    })
    return gasPrice.mul(gasLimit as BigNumber)
  }
}

export default OperatorChainService
