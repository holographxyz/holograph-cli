import {TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'
import {getNetworkByHolographId} from '@holographxyz/networks'
import {TransactionDescription} from '@ethersproject/abi'
import {Environment} from '@holographxyz/environment'

import {create2address, decodeDeploymentConfig, DeploymentConfig} from '../../utils/contract-deployment'
import {UpdateBridgedContract, UpdateBridgedERC20, UpdateBridgedERC721} from '../../types/indexer'
import {BridgeOutArgs, BridgeOutErc20Args, decodeBridgeOutErc20Args} from '../../utils/bridge'
import {sha3, storageSlot, toAscii} from '../../utils/utils'
import {NetworkMonitor} from '../../utils/network-monitor'
import {
  decodeCrossChainMessageSentEvent,
  decodeErc20TransferEvent,
  decodeErc721TransferEvent,
  decodeLzEvent,
  decodeLzPacketEvent,
} from '../../events/events'

async function handleBridgeOutEvent(
  networkMonitor: NetworkMonitor,
  environment: Environment,
  transaction: TransactionResponse,
  network: string,
  tags: (string | number)[],
  updateBridgedContract: UpdateBridgedContract,
  updateBridgedERC20: UpdateBridgedERC20,
  updateBridgedERC721: UpdateBridgedERC721,
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
        operatorJobHash = decodeCrossChainMessageSentEvent(receipt, networkMonitor.operatorAddress)
        if (operatorJobHash !== undefined) {
          args = decodeLzEvent(receipt, networkMonitor.lzEndpointAddress[network])
          if (args !== undefined) {
            operatorJobPayload = args[2] as string
          }
        }

        break
      default:
        operatorJobHash = decodeCrossChainMessageSentEvent(receipt, networkMonitor.operatorAddress)
        if (operatorJobHash !== undefined) {
          operatorJobPayload = decodeLzPacketEvent(receipt, networkMonitor.messagingModuleAddress)
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
          const direction = 'out'
          networkMonitor.structuredLog(network, `Calling updateBridgedContract with direction ${direction}`, tags)

          await updateBridgedContract.call(
            // @ts-expect-error 'this' is of type any
            this,
            direction,
            transaction,
            network,
            contractAddress,
            deploymentConfig,
            tags,
          )
        } else {
          const slot: string = await networkMonitor.providers[network].getStorageAt(
            holographableContractAddress,
            storageSlot('eip1967.Holograph.contractType'),
          )
          const contractType: string = toAscii(slot)

          if (contractType === 'HolographERC20') {
            // Bridge out ERC20 token
            const erc20BeamInfo: BridgeOutErc20Args = decodeBridgeOutErc20Args(bridgeOutPayload)
            const erc20TransferEvent: any[] | undefined = decodeErc20TransferEvent(
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
              const direction = 'out'
              networkMonitor.structuredLog(network, `Calling updateBridgedERC20 with direction ${direction}`, tags)

              // @ts-expect-error 'this' is of type any
              await updateBridgedERC20.call(this, transaction, network, erc20BeamInfo, tags)
            }
          } else if (contractType === 'HolographERC721') {
            // Bridge in ERC721 token
            const erc721TransferEvent: any[] | undefined = decodeErc721TransferEvent(
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
              const direction = 'out'
              networkMonitor.structuredLog(network, `Calling updateBridgedERC721 with direction ${direction}`, tags)

              await updateBridgedERC721.call(
                // @ts-expect-error 'this' is of type any
                this,
                direction,
                transaction,
                network,
                fromNetwork,
                toNetwork,
                contractType,
                holographableContractAddress,
                erc721TransferEvent,
                operatorJobHash,
                tags,
              )
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
