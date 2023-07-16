import {Contract} from '@ethersproject/contracts'
import {TransactionReceipt} from '@ethersproject/providers'
import {BigNumber} from '@ethersproject/bignumber'

import {getSecondsLeft} from '../utils/utils'
import {toShort18, toShort18Str} from '../utils/web3'
import CoreChainService from './core-chain-service'
import {NetworkMonitor} from '../utils/network-monitor'

export interface FaucetFee {
  fee: string
  hasEnoughBalance: boolean
}

export interface FaucetInfo {
  amount: string
  cooldown: number
  isAllowedToWithdraw: boolean
}

class FaucetService extends CoreChainService {
  faucet: Contract

  constructor(network: string, networkMonitor: NetworkMonitor, contract?: Contract) {
    super(network, networkMonitor)
    this.faucet = contract ? contract : this.getFaucet()
  }

  estimateGasForRequestTokens = async (): Promise<BigNumber> => {
    const gasPrice: BigNumber = this.getChainGasPrice()
    const gasLimit = await this.networkMonitor.getGasLimit({
      contract: this.faucet,
      methodName: 'requestTokens',
      args: [],
      network: this.network,
      gasPrice,
    })
    return gasPrice.mul(gasLimit as BigNumber)
  }

  getFaucetCooldown = async (address: string): Promise<number> => {
    const faucetDefaultCooldown = (await this.faucet.faucetCooldown())?.toNumber()
    const lastWithdrawTimestamp = (await this.faucet.getLastAccessTime(address))?.toNumber()
    const cooldownTimestamp = lastWithdrawTimestamp + faucetDefaultCooldown
    return lastWithdrawTimestamp === 0 ? 0 : getSecondsLeft(cooldownTimestamp)
  }

  getFaucetFee = async (address: string): Promise<FaucetFee> => {
    const cooldown = await this.getFaucetCooldown(address)
    if (cooldown > 0) return {fee: '', hasEnoughBalance: true}
    const balance = (await this.getBalance(address))?.toString()
    const gas = await this.estimateGasForRequestTokens()
    const fee = toShort18Str(gas?.toString())
    const hasEnoughBalance = Number(fee) < Number(balance)
    return {fee, hasEnoughBalance}
  }

  getFaucetInfo = async (address: string): Promise<FaucetInfo> => {
    const dripAmount = await this.faucet.faucetDripAmount()
    const amount = toShort18(dripAmount)?.toString()
    const cooldown = await this.getFaucetCooldown(address)
    const isAllowedToWithdraw = await this.faucet.isAllowedToWithdraw(address)
    return {amount, cooldown, isAllowedToWithdraw}
  }

  requestTokens = async (): Promise<TransactionReceipt | null> => {
    return this.networkMonitor.executeTransaction({
      network: this.network,
      contract: this.faucet,
      methodName: 'requestTokens',
      args: [],
      waitForReceipt: true,
    })
  }
}

export default FaucetService
