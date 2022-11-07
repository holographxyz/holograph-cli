import {Contract} from '@ethersproject/contracts'
import {BigNumber} from '@ethersproject/bignumber'
import {Wallet} from '@ethersproject/wallet'
import {JsonRpcProvider, WebSocketProvider} from '@ethersproject/providers'
import {TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'
import {getEnvironment} from '@holographxyz/environment'

import {FAUCET_ADDRESSES, HOLOGRAPH_ADDRESSES, LZ_RELAYER_ADDRESSES, getABIs} from '../utils/contracts'
import {NetworkMonitor} from '../utils/network-monitor'

const ENVIRONMENT = getEnvironment()
const HOLOGRAPH_ADDRESS = HOLOGRAPH_ADDRESSES[ENVIRONMENT]
const HLG_FAUCET_ADDRESS = FAUCET_ADDRESSES[ENVIRONMENT]

class CoreChainService {
  network: string
  networkMonitor: NetworkMonitor
  holograph: Contract | undefined
  abis: {[key: string]: any} = {}

  get provider(): JsonRpcProvider | WebSocketProvider {
    return this.networkMonitor.providers[this.network]
  }

  get wallet(): Wallet {
    return this.networkMonitor.wallets[this.network]
  }

  constructor(network: string, networkMonitor: NetworkMonitor) {
    this.network = network
    this.networkMonitor = networkMonitor
  }

  // NOTE: This must be called on instantiation!
  async initialize(): Promise<void> {
    this.abis = await getABIs(ENVIRONMENT)
    this.holograph = new Contract(HOLOGRAPH_ADDRESS, this.abis.HolographABI, this.wallet)
  }

  getChainGasPrice = (): BigNumber => {
    let gasPrice: BigNumber = this.networkMonitor.gasPrices[this.network].gasPrice!
    gasPrice = gasPrice.add(gasPrice.div(BigNumber.from('4')))
    return gasPrice
  }

  getCxipNFT = (collection: string): Contract => {
    return new Contract(collection, this.abis.CxipERC721ABI, this.wallet)
  }

  getBridge = async (): Promise<Contract> => {
    const address = await this.holograph?.getBridge()
    return new Contract(address, this.abis.HolographBridgeABI, this.wallet)
  }

  getFactory = async (): Promise<Contract> => {
    const address = await this.holograph?.getFactory()
    return new Contract(address, this.abis.HolographFactoryABI, this.wallet)
  }

  getFaucet = (): Contract => {
    return new Contract(HLG_FAUCET_ADDRESS, this.abis.FaucetABI, this.wallet)
  }

  getInterfaces = async (): Promise<Contract> => {
    const address = await this.holograph?.getInterfaces()
    return new Contract(address, this.abis.HolographInterfacesABI, this.wallet)
  }

  getOperator = async (): Promise<Contract> => {
    const address = await this.holograph?.getOperator()
    return new Contract(address, this.abis.HolographOperatorABI, this.wallet)
  }

  getRegistry = async (): Promise<Contract> => {
    const address = await this.holograph?.getRegistry()
    return new Contract(address, this.abis.HolographRegistryABI, this.wallet)
  }

  getRegistryAddress = async (): Promise<string> => {
    return this.holograph?.getRegistry()
  }

  getUtilityToken = async (): Promise<Contract> => {
    const address = await this.holograph?.getUtilityToken()
    return new Contract(address, this.abis.HolographERC20ABI, this.wallet)
  }

  getLZ = (): Contract => {
    return new Contract(LZ_RELAYER_ADDRESSES[this.network], this.abis.LayerZeroABI, this.wallet)
  }

  getWalletAddress = async (): Promise<string> => {
    return this.wallet.getAddress()
  }

  getBalance = async (account?: string): Promise<BigNumber> => {
    if (account === undefined) {
      account = this.wallet.address
    }

    return this.networkMonitor.getBalance({
      walletAddress: account,
      network: this.network,
    })
  }

  getTransaction = async (txHash: string): Promise<TransactionResponse | null> => {
    return this.networkMonitor.getTransaction({
      transactionHash: txHash,
      network: this.network,
    })
  }

  waitForTransaction = async (txHash: string): Promise<TransactionReceipt> => {
    return this.provider.waitForTransaction(txHash)
  }
}

export default CoreChainService
