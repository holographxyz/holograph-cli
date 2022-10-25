import {Contract} from '@ethersproject/contracts'
import {StaticJsonRpcProvider, JsonRpcProvider, Web3Provider, TransactionReceipt} from '@ethersproject/providers'

import {toShort18, toShort18Str, waitForTransactionComplete} from '../utils/contracts'
import {getSecondsLeft} from '../utils/utils'

import CoreChainService from './core-chain-service'
import {BigNumberish, ethers} from 'ethers'

interface FaucetFee {
  fee: string
  hasEnoughBalance: boolean
}

interface FaucetInfo {
  amount: string
  cooldown: number
  isAllowedToWithdraw: boolean
}

class FaucetService extends CoreChainService {
  faucet: Contract

  constructor(
    provider: JsonRpcProvider | StaticJsonRpcProvider | Web3Provider,
    wallet: ethers.Wallet,
    chainId: number,
    contract?: Contract,
  ) {
    super(provider, wallet, chainId)
    this.faucet = contract ? contract : this.getFaucet()
  }

  estimateGasForRequestTokens = async (): Promise<BigNumberish> => {
    const gasPrice = await this.getChainGasPrice()
    const gasLimit = await this.faucet.estimateGas.requestTokens()
    return gasPrice.mul(gasLimit)
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

  requestTokens = async (): Promise<TransactionReceipt> => {
    const tx = await this.faucet.requestTokens()
    await waitForTransactionComplete(tx.wait)
    return this.waitForTransaction(tx.hash)
  }
}

export default FaucetService
