import {TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'
import {getNetworkByHolographId} from '@holographxyz/networks'
import {TransactionDescription} from '@ethersproject/abi'

import {UpdateBridgedContract, UpdateBridgedERC20, UpdateBridgedERC721} from '../../types/indexer'
import {BridgeInArgs, BridgeInErc20Args, decodeBridgeInErc20Args} from '../../utils/bridge'
import {sha3, storageSlot, toAscii} from '../../utils/utils'
import {NetworkMonitor} from '../../utils/network-monitor'
import {
  create2address,
  decodeDeploymentConfig,
  DeploymentConfig,
  deploymentConfigHash,
} from '../../utils/contract-deployment'

async function handleBridgeInEvent(
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
    networkMonitor.structuredLog(network, `Checking for executeJob function`, tags)
    const parsedTransaction: TransactionDescription =
      networkMonitor.operatorContract.interface.parseTransaction(transaction)

    if (parsedTransaction.name === 'executeJob') {
      networkMonitor.structuredLog(network, `Extracting bridgeInRequest from transaction`, tags)

      const args: any[] | undefined = Object.values(parsedTransaction.args)
      const operatorJobPayload: string | undefined = args === undefined ? undefined : args[0]
      const operatorJobHash: string | undefined =
        operatorJobPayload === undefined ? undefined : sha3(operatorJobPayload)

      if (operatorJobHash === undefined) {
        networkMonitor.structuredLog(network, `Could not find bridgeInRequest in ${transaction.hash}`, tags)
      } else {
        const finishedOperatorJobEvent = networkMonitor.decodeFinishedOperatorJobEvent(receipt)

        if (finishedOperatorJobEvent !== undefined) {
          networkMonitor.structuredLog(
            network,
            `FinishedOperatorJob Event: {"tx": ${transaction.hash}, "jobHash": ${finishedOperatorJobEvent[0]}, "operator": ${finishedOperatorJobEvent[1]} }`,
            tags,
          )
        }

        const failedOperatorJobEvent = networkMonitor.decodeFailedOperatorJobEvent(receipt)

        if (failedOperatorJobEvent !== undefined) {
          networkMonitor.structuredLog(
            network,
            `FailedOperator Event: {"tx": ${transaction.hash}, "jobHash": ${failedOperatorJobEvent} }`,
            tags,
          )
        }

        networkMonitor.structuredLog(network, `Decoding bridgeInRequest`, tags)

        const bridgeTransaction: TransactionDescription | null =
          networkMonitor.bridgeContract.interface.parseTransaction({data: operatorJobPayload!})

        if (bridgeTransaction === null) {
          networkMonitor.structuredLog(network, `Could not decode bridgeInRequest in ${transaction.hash}`, tags)
        } else {
          networkMonitor.structuredLog(network, `Parsing bridgeInRequest data`, tags)

          const bridgeIn: BridgeInArgs = bridgeTransaction.args as unknown as BridgeInArgs
          const fromNetwork: string = getNetworkByHolographId(bridgeIn.fromChain).key
          const toNetwork: string = network
          const bridgeInPayload: string = bridgeIn.bridgeInPayload
          const holographableContractAddress: string = bridgeIn.holographableContract.toLowerCase()

          if (holographableContractAddress === networkMonitor.factoryAddress) {
            networkMonitor.structuredLog(network, `BridgeInRequest identified as contract deployment`, tags)
            networkMonitor.structuredLog(network, `Extracting deployment details`, tags)
            const deploymentEvent: string[] | undefined = networkMonitor.decodeBridgeableContractDeployedEvent(
              receipt,
              networkMonitor.factoryAddress,
            )

            if (deploymentEvent === undefined) {
              networkMonitor.structuredLog(
                network,
                `Failed extracting deployment details from BridgeableContractDeployed event`,
                tags,
              )
            } else {
              networkMonitor.structuredLog(network, `Decoding DeploymentConfig`, tags)

              const deploymentConfig: DeploymentConfig = decodeDeploymentConfig(bridgeInPayload)
              const deploymentHash: string = deploymentConfigHash(deploymentConfig)
              const contractAddress = create2address(deploymentConfig, networkMonitor.factoryAddress)

              if (deploymentHash !== deploymentEvent[1]) {
                throw new Error(`DeploymentConfig hashes ${deploymentHash} and ${deploymentEvent[1]} do not match!`)
              }

              if (contractAddress !== deploymentEvent[0]) {
                throw new Error(`Deployment addresses ${contractAddress} and ${deploymentEvent[0]} do not match!`)
              }

              const direction = 'in'
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
            }
          } else {
            networkMonitor.structuredLog(network, `Decoding contractType`, tags)
            const slot: string = await networkMonitor.providers[network].getStorageAt(
              holographableContractAddress,
              storageSlot('eip1967.Holograph.contractType'),
            )
            const contractType: string = toAscii(slot)

            if (contractType === 'HolographERC20') {
              networkMonitor.structuredLog(network, `BridgeInRequest identified as ERC20 transfer`, tags)
              // BRIDGE IN ERC20 TOKENS
              const erc20BeamInfo: BridgeInErc20Args = decodeBridgeInErc20Args(bridgeInPayload)
              const erc20TransferEvent: any[] | undefined = networkMonitor.decodeErc20TransferEvent(
                receipt,
                holographableContractAddress,
              )

              if (erc20TransferEvent === undefined) {
                networkMonitor.structuredLog(network, `Could not find a valid ERC20 Transfer event`, tags)
              } else {
                const direction = 'in'
                networkMonitor.structuredLog(network, `Calling updateBridgedERC20 with direction ${direction}`, tags)

                // @ts-expect-error 'this' is of type any
                await updateBridgedERC20.call(this, transaction, network, erc20BeamInfo, tags)
              }
            } else if (contractType === 'HolographERC721') {
              networkMonitor.structuredLog(network, `BridgeInRequest identified as ERC721 transfer`, tags)
              // Bridge i
              const erc721TransferEvent: any[] | undefined = networkMonitor.decodeErc721TransferEvent(
                receipt,
                holographableContractAddress,
              )

              if (erc721TransferEvent === undefined) {
                networkMonitor.structuredLog(network, `Could not find a valid ERC721 Transfer event`, tags)
              } else {
                networkMonitor.structuredLog(network, `updateBridgedERC721`, tags)
                const direction = 'in'
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
              networkMonitor.structuredLog(network, `unknown BridgeInRequest contractType`, tags)
            }
          }
        }
      }
    } else {
      networkMonitor.structuredLog(network, `Function call was ${parsedTransaction.name} and not executeJob`, tags)
    }
  } else {
    networkMonitor.structuredLog(network, `Transaction failed, ignoring it`, tags)
  }
}

export default handleBridgeInEvent
