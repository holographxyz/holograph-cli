import {TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'
import {getNetworkByHolographId} from '@holographxyz/networks'
import {TransactionDescription} from '@ethersproject/abi'

import SqsService from '../../services/sqs-service'
import {BridgeDirection, ContractType, PayloadType, SqsMessageBody} from '../../types/sqs'
import {BridgeInArgs, BridgeInErc20Args, decodeBridgeInErc20Args} from '../../utils/bridge'
import {capitalize, networkToChainId, sha3, storageSlot, toAscii} from '../../utils/utils'
import {NetworkMonitor} from '../../utils/network-monitor'
import {
  create2address,
  decodeDeploymentConfig,
  DeploymentConfig,
  deploymentConfigHash,
} from '../../utils/contract-deployment'
import {hexZeroPad} from '@ethersproject/bytes'

async function handleBridgeInEvent(
  networkMonitor: NetworkMonitor,
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

              networkMonitor.structuredLog(
                network,
                `HolographOperator executed a job which bridged a collection. HolographFactory deployed a new collection on ${capitalize(
                  network,
                )} at address ${contractAddress}. Operator that deployed the collection is ${
                  transaction.from
                }. The config used for deployHolographableContract function was ${JSON.stringify(
                  deploymentConfig,
                  undefined,
                  2,
                )}`,
                tags,
              )

              const messageBody: SqsMessageBody = {
                type: PayloadType.HolographProtocol,
                eventName: 'BridgeableContractDeployed(address indexed contractAddress, bytes32 indexed hash)',
                tagId: tags,
                chainId: networkToChainId[network],
                holographAddress: networkMonitor.HOLOGRAPH_ADDRESSES[networkMonitor.environment],
                environment: networkMonitor.environment,
                payload: {
                  tx: transaction.hash,
                  blockNum: Number(transaction.blockNumber),
                  contractAddress,
                  deploymentConfig,
                  direction: BridgeDirection.In,
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
                    erc20BeamInfo,
                    direction: BridgeDirection.In,
                    contractType: ContractType.HolographERC20,
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
                    contractAddress: holographableContractAddress,
                    direction: BridgeDirection.In,
                    operatorJobHash,
                    fromNetwork,
                    toNetwork,
                    contractType: ContractType.HolographERC721,
                    nftTokenId: tokenId,
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
