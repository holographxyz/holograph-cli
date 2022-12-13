import {TransactionReceipt} from '@ethersproject/providers'
import {Contract} from '@ethersproject/contracts'
import {BigNumber, BigNumberish} from '@ethersproject/bignumber'

import CoreChainService from './core-chain-service'
import {NetworkMonitor} from '../utils/network-monitor'

class TokenChainService extends CoreChainService {
  token: Contract
  constructor(network: string, networkMonitor: NetworkMonitor, contract: Contract) {
    super(network, networkMonitor)
    this.token = contract
  }

  balanceOf = async (account: string): Promise<BigNumberish> => this.token.balanceOf(account)

  allowance = async (account: string, operator: string): Promise<BigNumber> => this.token.allowance(account, operator)

  approve = async (operator: string, amount: BigNumberish): Promise<TransactionReceipt> => {
    const tx = await this.token.approve(operator, amount)
    await tx.wait()
    return tx
  }
}

export default TokenChainService
