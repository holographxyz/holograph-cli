import {Contract} from '@ethersproject/contracts'
import {StaticJsonRpcProvider, JsonRpcProvider, Web3Provider} from '@ethersproject/providers'
import {FeeData, TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'
import {BigNumberish} from '@ethersproject/bignumber'

import {FAUCET_ADDRESSES, HOLOGRAPH_ADDRESSES, LZ_RELAYER_ADDRESSES, getABIs} from '../utils/contracts'
import {getEnvironment} from '../utils/environment'
import {BigNumber, ethers} from 'ethers'

const ENVIRONMENT = getEnvironment()
const HOLOGRAPH_ADDRESS = HOLOGRAPH_ADDRESSES[ENVIRONMENT]
const HLG_FAUCET_ADDRESS = FAUCET_ADDRESSES[ENVIRONMENT]

class CoreChainService {
  provider: JsonRpcProvider | StaticJsonRpcProvider | Web3Provider
  wallet: ethers.Wallet
  holograph: Contract | undefined
  chainId: number
  abis: {[key: string]: any} = {}

  constructor(
    provider: JsonRpcProvider | StaticJsonRpcProvider | Web3Provider,
    wallet: ethers.Wallet,
    chainId: number,
  ) {
    this.provider = provider
    this.chainId = chainId
    this.wallet = wallet
  }

  // NOTE: This must be called on instantiation!
  async initialize() {
    this.abis = await getABIs(ENVIRONMENT)
    this.holograph = new Contract(HOLOGRAPH_ADDRESS, this.abis.HolographABI, this.wallet)
  }

  getProviderGasPrice = async (): Promise<BigNumber> => {
    const price = await this.provider.getFeeData()
    return BigNumber.from(price.maxFeePerGas || price.gasPrice || 1)
  }

  getProviderFeeData = async (): Promise<{
    maxFeePerGas: BigNumber
    maxPriorityFeePerGas: BigNumber
    gasPrice: BigNumber
  }> => {
    const feeData: FeeData = await this.provider.getFeeData()
    return {
      maxFeePerGas: feeData.maxFeePerGas || feeData.gasPrice || BigNumber.from(1),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || BigNumber.from(0),
      gasPrice: feeData.gasPrice || BigNumber.from(1),
    }
  }

  getFactory = async (): Promise<Contract> => {
    const address = await this.holograph?.getFactory()
    return new Contract(address, this.abis.HolographFactoryABI, this.wallet)
  }

  getBridge = async (): Promise<Contract> => {
    const address = await this.holograph?.getBridge()
    return new Contract(address, this.abis.HolographBridgeABI, this.wallet)
  }

  getInterfaces = async (): Promise<Contract> => {
    const address = await this.holograph?.getInterfaces()
    return new Contract(address, this.abis.HolographInterfacesABI, this.wallet)
  }

  getOperator = async (): Promise<Contract> => {
    const address = await this.holograph?.getOperator()
    return new Contract(address, this.abis.HolographOperatorABI, this.wallet)
  }

  getUtilityToken = async (): Promise<Contract> => {
    const address = await this.holograph?.getUtilityToken()
    return new Contract(address, this.abis.HolographERC20ABI, this.wallet)
  }

  getRegistryAddress = async (): Promise<string> => {
    return this.holograph?.getRegistry()
  }

  getChainGasPrice = async (): Promise<BigNumber> => {
    return this.provider.getGasPrice()
  }

  getTransaction = async (txHash: string): Promise<TransactionResponse> => {
    return this.provider.getTransaction(txHash)
  }

  waitForTransaction = async (txHash: string): Promise<TransactionReceipt> => {
    return this.provider.waitForTransaction(txHash)
  }

  getCxipNFT = (collection: string): Contract => {
    return new Contract(collection, this.abis.CxipNFTABI, this.wallet)
  }

  getLZ = (): Contract => {
    return new Contract(LZ_RELAYER_ADDRESSES[this.chainId], this.abis.LayerZeroABI, this.wallet)
  }

  getFaucet = (): Contract => {
    return new Contract(HLG_FAUCET_ADDRESS, this.abis.FaucetABI, this.wallet)
  }

  getBalance = async (account: string): Promise<BigNumberish> => {
    return this.provider.getBalance(account)
  }

  getSignerAddress = async (): Promise<string> => {
    return this.provider.getSigner().getAddress()
  }

}

export default CoreChainService
