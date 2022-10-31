import {JsonRpcProvider, StaticJsonRpcProvider, TransactionReceipt, Web3Provider} from '@ethersproject/providers'
import {BigNumberish, Contract, ethers} from 'ethers'
import CoreChainService from './core-chain-service'

class TokenChainService extends CoreChainService {
  token: Contract
  constructor(
    provider: JsonRpcProvider | StaticJsonRpcProvider | Web3Provider,
    wallet: ethers.Wallet,
    chainId: number,
    contract: Contract,
  ) {
    super(provider, wallet, chainId)
    this.token = contract
  }

  balanceOf = async (account: string): Promise<BigNumberish> => this.token.balanceOf(account)

  allowance = async (account: string, operator: string): Promise<BigNumberish> =>
    this.token.allowance(account, operator)

  approve = async (operator: string, amount: BigNumberish): Promise<TransactionReceipt> => {
    const tx = await this.token.approve(operator, amount)
    await tx.wait()
    return tx
  }
}

export default TokenChainService
