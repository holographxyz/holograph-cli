import {BigNumberish} from '@ethersproject/bignumber'
import {AddressZero} from '@ethersproject/constants'
import {Contract} from '@ethersproject/contracts'
import {JsonRpcProvider, StaticJsonRpcProvider, Web3Provider} from '@ethersproject/providers'
import {BytesLike, ethers} from 'ethers'

import {GasFee} from '../types/interfaces'
import {waitForTransactionComplete} from '../utils/contracts'
import {sleep} from '../utils/utils'
import CoreChainService from './core-chain-service'
// import {NetworkMonitor} from '../utils/network-monitor'

class NFTChainService extends CoreChainService {
  cxipNFT: Contract

  constructor(
    provider: JsonRpcProvider | StaticJsonRpcProvider | Web3Provider,
    wallet: ethers.Wallet,
    chainId: number,
    address: string,
    contract?: Contract,
  ) {
    super(provider, wallet, chainId)
    this.cxipNFT = contract ? contract : this.getCxipNFT(address)
  }

  isExists = async (tokenId: number | string): Promise<boolean> => {
    return this.cxipNFT.exists(tokenId)
  }

  getTokenId = async (account: string, blockNumber: number): Promise<BigNumberish> => {
    // eslint-disable-next-line new-cap
    const filter = this.cxipNFT.filters.Transfer(AddressZero, account, null)
    const logs = await this.cxipNFT.queryFilter(filter, blockNumber, 'latest')
    if (logs.length === 0) {
      await sleep(1000)
      return this.getTokenId(account, blockNumber)
    }

    return (logs[logs.length - 1] as any).args[2]
  }

  estimateGasForMintingNFT = async (tokenURI?: string): Promise<GasFee> => {
    const gasPrice = await this.getChainGasPrice()
    const gasLimit = await this.cxipNFT.estimateGas.cxipMint(0, 1, tokenURI || '')

    return {
      gasPrice,
      gasLimit,
      gas: gasPrice.mul(gasLimit),
    }
  }

  mintNft = async (tokenUri: string, account: string): Promise<any> => {
    const block = await this.provider.getBlock('latest')

    const {gasLimit} = await this.estimateGasForMintingNFT(tokenUri)
    const tx = await this.cxipNFT.cxipMint(0, 1, tokenUri, {
      gasLimit,
    })

    await waitForTransactionComplete(tx.wait)

    const tokenId = (await this.getTokenId(account, block.number)) as BytesLike
    const tokenIdBytesString = ethers.utils.hexZeroPad(tokenId, 32)
    return {
      tx: await this.waitForTransaction(tx.hash),
      tokenId: tokenIdBytesString,
    }
  }

  approveNFT = async (operator: string, owner: string, tokenId: number | string) => {
    if (
      owner !== operator &&
      (await this.cxipNFT.getApproved(tokenId)) !== operator &&
      (await this.cxipNFT.isApprovedForAll(owner, operator)) === false
    ) {
      await (await this.cxipNFT.approve(operator, tokenId)).wait()
    }
  }
}

export default NFTChainService
