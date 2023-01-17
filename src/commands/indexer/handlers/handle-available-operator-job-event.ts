import {TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'
import {getNetworkByHolographId} from '@holographxyz/networks'
import {TransactionDescription} from '@ethersproject/abi'
import {BigNumber} from 'ethers'

import {create2address, decodeDeploymentConfig, DeploymentConfig} from '../../../utils/contract-deployment'
import {UpdateBridgedContract, UpdateBridgedERC20, UpdateBridgedERC721} from '../../../types/indexer'
import {sha3, storageSlot, toAscii} from '../../../utils/utils'
import {NetworkMonitor} from '../../../utils/network-monitor'
import {
  BridgeInArgs,
  BridgeInErc721Args,
  BridgeOutErc20Args,
  decodeBridgeInErc721Args,
  decodeBridgeOutErc20Args,
} from '../../../utils/bridge'

async function handleAvailableOperatorJobEvent(
  networkMonitor: NetworkMonitor,
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
    const operatorJobPayloadData = networkMonitor.decodeAvailableOperatorJobEvent(
      receipt,
      networkMonitor.operatorAddress,
    )

    const operatorJobHash = operatorJobPayloadData === undefined ? undefined : operatorJobPayloadData[0]
    const operatorJobPayload = operatorJobPayloadData === undefined ? undefined : operatorJobPayloadData[1]

    if (operatorJobHash === undefined) {
      networkMonitor.structuredLog(network, `No AvailableOperatorJob event found`, tags)
    } else {
      // Check that operatorJobPayload and operatorJobHash are the same
      if (sha3(operatorJobPayload) !== operatorJobHash) {
        throw new Error('The hashed operatorJobPayload does not equal operatorJobHash!')
      }

      networkMonitor.structuredLog(network, `Decoding bridgeInRequest`, tags)

      const bridgeTransaction: TransactionDescription = networkMonitor.bridgeContract.interface.parseTransaction({
        data: operatorJobPayload!,
      })

      if (bridgeTransaction.name === 'bridgeInRequest') {
        const bridgeIn: BridgeInArgs = bridgeTransaction.args as unknown as BridgeInArgs
        const fromNetwork: string = getNetworkByHolographId(bridgeIn.fromChain).key
        const toNetwork: string = network
        const bridgeInPayload: string = bridgeIn.bridgeInPayload
        const holographableContractAddress: string = bridgeIn.holographableContract.toLowerCase()

        // Bridge out contract deployment
        if (holographableContractAddress === networkMonitor.factoryAddress) {
          const deploymentConfig: DeploymentConfig = decodeDeploymentConfig(bridgeInPayload)
          const contractAddress = create2address(deploymentConfig, networkMonitor.factoryAddress)
          const direction = 'msg'

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
            const erc20BeamInfo: BridgeOutErc20Args = decodeBridgeOutErc20Args(bridgeInPayload)
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
              // We do not currently capture bridge events for ERC
              const direction = 'msg'
              networkMonitor.structuredLog(network, `Calling updateBridgedERC20 with direction ${direction}`, tags)

              // @ts-expect-error 'this' is of type any
              await updateBridgedERC20.call(this, transaction, network, erc20BeamInfo, tags)
            }
          } else if (contractType === 'HolographERC721') {
            // Bridge in ERC721 token
            const erc721BeamInfo: BridgeInErc721Args = decodeBridgeInErc721Args(bridgeInPayload)
            const direction = 'msg'

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
              [erc721BeamInfo.from, erc721BeamInfo.to, BigNumber.from(erc721BeamInfo.tokenId)],
              operatorJobHash,
              tags,
            )
          }
        }

        networkMonitor.structuredLog(network, `Found a valid bridgeInRequest for ${transaction.hash}`, tags)
      } else {
        networkMonitor.structuredLog(network, `Unknown bridgeIn function executed for ${transaction.hash}`, tags)
      }

      networkMonitor.structuredLog(
        network,
        `Bridge-In transaction type: ${bridgeTransaction.name} -->> ${bridgeTransaction.args}`,
      )
    }
  } else {
    networkMonitor.structuredLog(network, `Transaction failed, ignoring it`, tags)
  }
}

export default handleAvailableOperatorJobEvent
