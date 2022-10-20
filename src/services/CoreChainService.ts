import {Contract} from '@ethersproject/contracts'
import {StaticJsonRpcProvider, JsonRpcProvider, Web3Provider} from '@ethersproject/providers'
import {FeeData, TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'
import {BigNumber, BigNumberish} from '@ethersproject/bignumber'

import {
  CHAIN_IDS,
  MUMBAI_GAS_PRICE,
  FAUCET_ADDRESSES,
  HOLOGRAPH_ADDRESSES,
  LZ_RELAYER_ADDRESSES,
  getABIs,
} from '../utils/contracts'
import {getEnvironment} from '../utils/environment'

const HOLOGRAPH_ADDRESS = HOLOGRAPH_ADDRESSES[getEnvironment()]
const HLG_FAUCET_ADDRESS = FAUCET_ADDRESSES[getEnvironment()]

let abis: {[key: string]: any} = {}

class CoreChainService {
  provider: JsonRpcProvider | StaticJsonRpcProvider | Web3Provider
  holograph: Contract
  chainId: SupportedChainIds

  constructor(library: JsonRpcProvider | StaticJsonRpcProvider | Web3Provider, chainId: SupportedChainIds) {
    this.provider = library
    this.holograph = new Contract(HOLOGRAPH_ADDRESS, abis.HolographABI, library?.getSigner())
    this.chainId = chainId

    this.init()
  }

  async init() {
    abis = await getABIs()
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
    const address = await this.holograph.getFactory()
    return new Contract(address, abis.HolographFactoryABI, this.provider?.getSigner())
  }

  getBridge = async (): Promise<Contract> => {
    const address = await this.holograph.getBridge()
    return new Contract(address, abis.HolographBridgeABI, this.provider?.getSigner())
  }

  getInterfaces = async (): Promise<Contract> => {
    const address = await this.holograph.getInterfaces()
    return new Contract(address, abis.HolographInterfacesABI, this.provider?.getSigner())
  }

  getOperator = async (): Promise<Contract> => {
    const address = await this.holograph.getOperator()
    return new Contract(address, abis.HolographOperatorABI, this.provider?.getSigner())
  }

  getUtilityToken = async (): Promise<Contract> => {
    const address = await this.holograph.getUtilityToken()
    return new Contract(address, abis.HolographERC20ABI, this.provider?.getSigner())
  }

  getRegistryAddress = async (): Promise<string> => {
    return this.holograph.getRegistry()
  }

  getChainGasPrice = async (): Promise<BigNumber> => {
    return this.provider.getGasPrice()
  }

  getTransaction = async (txHash: string): Promise<TransactionResponse> => {
    return await this.provider.getTransaction(txHash)
  }

  waitForTransaction = async (txHash: string): Promise<TransactionReceipt> => {
    return await this.provider.waitForTransaction(txHash)
  }

  getCxipNFT = (collection: string): Contract => {
    return new Contract(collection, abis.CxipNFTABI, this.provider?.getSigner())
  }

  getLZ = (): Contract => {
    return new Contract(LZ_RELAYER_ADDRESSES[this.chainId], abis.LayerZeroABI, this.provider?.getSigner())
  }

  getFaucet = (): Contract => {
    return new Contract(HLG_FAUCET_ADDRESS, abis.FaucetABI, this.provider?.getSigner())
  }

  getBalance = async (account: string): Promise<BigNumberish> => {
    return this.provider.getBalance(account)
  }

  getSignerAddress = async (): Promise<string> => {
    return this.provider.getSigner().getAddress()
  }

  adjustGasPrice = async (): Promise<BigNumberish> => {
    const gasPrice = BigNumber.from(await this.getChainGasPrice())
    if (this.chainId === CHAIN_IDS.mumbai && gasPrice.lt(MUMBAI_GAS_PRICE)) {
      return MUMBAI_GAS_PRICE
    }

    return gasPrice
  }
}

export default CoreChainService
