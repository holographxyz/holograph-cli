import {TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'
import {getNetworkByHolographId} from '@holographxyz/networks'
import {TransactionDescription} from '@ethersproject/abi'
import {Environment} from '@holographxyz/environment'

import {create2address, decodeDeploymentConfig, DeploymentConfig} from '../../utils/contract-deployment'
import {BridgeOutArgs, BridgeOutErc20Args, decodeBridgeOutErc20Args} from '../../utils/bridge'
import {networkToChainId, sha3, storageSlot, toAscii} from '../../utils/utils'
import {NetworkMonitor} from '../../utils/network-monitor'
import {BridgeDirection, ContractType, PayloadType, SqsMessageBody} from '../../types/sqs'
import SqsService from '../../services/sqs-service'
import {hexZeroPad} from '@ethersproject/bytes'

async function handleBridgeOutEvent(
  networkMonitor: NetworkMonitor,
  environment: Environment,
  transaction: TransactionResponse,
  network: string,
  tags: (string | number)[],
): Promise<void> {
  const receipt: TransactionReceipt | null = await networkMonitor.getTransactionReceipt({
    network,
    transactionHash: transaction.hash,
    attempts: 10,
    canFail: true,
  })

  if (receipt === null) {
    throw new Error(`Could not get receipt for ${transaction.hash}`)
  }

  if (receipt.status === 1) {
    networkMonitor.structuredLog(network, `Checking for job hash`, tags)

    let operatorJobHash: string | undefined
    let operatorJobPayload: string | undefined
    let args: any[] | undefined

    switch (environment) {
      case Environment.localhost:
        operatorJobHash = networkMonitor.decodeCrossChainMessageSentEvent(receipt, networkMonitor.operatorAddress)

        if (operatorJobHash !== undefined) {
          args = networkMonitor.decodeLzEvent(receipt, networkMonitor.lzEndpointAddress[network])
          if (args !== undefined) {
            operatorJobPayload = args[2] as string
          }
        }

        break
      default:
        operatorJobHash = networkMonitor.decodeCrossChainMessageSentEvent(receipt, networkMonitor.operatorAddress)

        if (operatorJobHash !== undefined) {
          operatorJobPayload = networkMonitor.decodeLzPacketEvent(receipt)
        }

        break
    }

    if (operatorJobHash === undefined) {
      networkMonitor.structuredLog(network, `No CrossChainMessageSent event found`, tags)
    } else {
      // check that operatorJobPayload and operatorJobHash are the same
      if (sha3(operatorJobPayload) !== operatorJobHash) {
        throw new Error('The hashed operatorJobPayload does not equal operatorJobHash!')
      }

      const bridgeTransaction: TransactionDescription =
        networkMonitor.bridgeContract.interface.parseTransaction(transaction)

      if (bridgeTransaction.name === 'bridgeOutRequest') {
        const bridgeOut: BridgeOutArgs = bridgeTransaction.args as unknown as BridgeOutArgs
        const fromNetwork: string = network
        const toNetwork: string = getNetworkByHolographId(bridgeOut.toChain).key
        const bridgeOutPayload: string = bridgeOut.bridgeOutPayload
        const holographableContractAddress: string = bridgeOut.holographableContract.toLowerCase()

        if (holographableContractAddress === networkMonitor.factoryAddress) {
          // Bridge out contract deployment
          const deploymentConfig: DeploymentConfig = decodeDeploymentConfig(bridgeOutPayload)
          const contractAddress = create2address(deploymentConfig, networkMonitor.factoryAddress)

          const messageBody: SqsMessageBody = {
            type: PayloadType.HolographProtocol,
            eventName: 'CrossChainMessageSent(bytes32 messageHash)',
            tagId: tags,
            chainId: networkToChainId[network],
            holographAddress: networkMonitor.HOLOGRAPH_ADDRESSES[networkMonitor.environment],
            environment: networkMonitor.environment,
            payload: {
              tx: transaction.hash,
              blockNum: Number(transaction.blockNumber),
              contractAddress,
              deploymentConfig,
              direction: BridgeDirection.Out,
            },
          }

          networkMonitor.structuredLog(
            network,
            `sending message with MessageBody: ${JSON.stringify(messageBody)} to queue...`,
            tags,
          )

          const response = await SqsService.Instance.sendMessage(messageBody)

          networkMonitor.structuredLog(network, `Response: ${JSON.stringify(response)}`, tags)
        } else {
          const slot: string = await networkMonitor.providers[network].getStorageAt(
            holographableContractAddress,
            storageSlot('eip1967.Holograph.contractType'),
          )
          const contractType: string = toAscii(slot)

          if (contractType === 'HolographERC20') {
            // Bridge out ERC20 token
            const erc20BeamInfo: BridgeOutErc20Args = decodeBridgeOutErc20Args(bridgeOutPayload)
            const erc20TransferEvent: any[] | undefined = networkMonitor.decodeErc20TransferEvent(
              receipt,
              holographableContractAddress,
            )

            if (erc20TransferEvent === undefined) {
              networkMonitor.structuredLog(
                network,
                `Bridge erc20 transfer event not found for ${transaction.hash}`,
                tags,
              )
            } else {
              // We do not currently capture bridge events for ERC20 tokens

              const messageBody: SqsMessageBody = {
                type: PayloadType.ERC20,
                eventName: 'Transfer(address indexed _from, address indexed _to, uint256 _value)',
                tagId: tags,
                chainId: networkToChainId[network],
                holographAddress: networkMonitor.HOLOGRAPH_ADDRESSES[networkMonitor.environment],
                environment: networkMonitor.environment,
                payload: {
                  tx: transaction.hash,
                  blockNum: Number(transaction.blockNumber),
                  contractAddress: holographableContractAddress,
                  contractType: ContractType.HolographERC20,
                  direction: BridgeDirection.Out,
                  erc20BeamInfo,
                },
              }

              networkMonitor.structuredLog(
                network,
                `sending message with MessageBody: ${JSON.stringify(messageBody)} to queue...`,
                tags,
              )

              const response = await SqsService.Instance.sendMessage(messageBody)

              networkMonitor.structuredLog(network, `Response: ${JSON.stringify(response)}`, tags)
            }
          } else if (contractType === 'HolographERC721') {
            // Bridge in ERC721 token
            const erc721TransferEvent: any[] | undefined = networkMonitor.decodeErc721TransferEvent(
              receipt,
              holographableContractAddress,
            )

            if (erc721TransferEvent === undefined) {
              networkMonitor.structuredLog(
                network,
                `Bridge erc721 transfer event not found for ${transaction.hash}`,
                tags,
              )
            } else {
              const tokenId = hexZeroPad(erc721TransferEvent[2].toHexString(), 32)

              const messageBody: SqsMessageBody = {
                type: PayloadType.ERC721,
                eventName: 'Transfer(address indexed _from, address indexed _to, uint256 indexed _tokenId)',
                tagId: tags,
                chainId: networkToChainId[network],
                holographAddress: networkMonitor.HOLOGRAPH_ADDRESSES[networkMonitor.environment],
                environment: networkMonitor.environment,
                payload: {
                  tx: transaction.hash,
                  blockNum: Number(transaction.blockNumber),
                  direction: BridgeDirection.Out,
                  contractAddress: holographableContractAddress,
                  contractType: ContractType.HolographERC721,
                  nftTokenId: tokenId,
                  operatorJobHash,
                  fromNetwork,
                  toNetwork,
                },
              }

              networkMonitor.structuredLog(
                network,
                `sending message with MessageBody: ${JSON.stringify(messageBody)} to queue...`,
                tags,
              )

              const response = await SqsService.Instance.sendMessage(messageBody)

              networkMonitor.structuredLog(network, `Response: ${JSON.stringify(response)}`, tags)
            }
          } else {
            networkMonitor.structuredLog(network, `unknown bridgeOutRequest contractType`, tags)
          }
        }
      } else {
        networkMonitor.structuredLog(
          network,
          `Function call was ${bridgeTransaction.name} and not bridgeOutRequest`,
          tags,
        )
      }
    }
  } else {
    networkMonitor.structuredLog(network, `Transaction failed, ignoring it`, tags)
  }
}

export default handleBridgeOutEvent
