import {TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'

import {NetworkMonitor} from '../../utils/network-monitor'
import {UpdateDeployedContract} from '../../types/indexer'
import {
  create2address,
  decodeDeploymentConfigInput,
  DeploymentConfig,
  deploymentConfigHash,
} from '../../utils/contract-deployment'

async function handleContractDeployedEvent(
  networkMonitor: NetworkMonitor,
  transaction: TransactionResponse,
  network: string,
  tags: (string | number)[],
  updateDeployedContract: UpdateDeployedContract,
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
    networkMonitor.structuredLog(network, `Checking for deployment details`, tags)

    const deploymentEvent: string[] | undefined = networkMonitor.decodeBridgeableContractDeployedEvent(
      receipt,
      networkMonitor.factoryAddress,
    )

    if (deploymentEvent === undefined) {
      networkMonitor.structuredLog(network, `No BridgeableContractDeployed event found`, tags)
    } else {
      networkMonitor.structuredLog(network, `Decoding DeploymentConfig`, tags)

      const deploymentConfig: DeploymentConfig = decodeDeploymentConfigInput(transaction.data)
      const deploymentHash: string = deploymentConfigHash(deploymentConfig)
      const contractAddress = create2address(deploymentConfig, networkMonitor.factoryAddress)

      if (deploymentHash !== deploymentEvent[1]) {
        throw new Error(`DeploymentConfig hashes ${deploymentHash} and ${deploymentEvent[1]} do not match!`)
      }

      if (contractAddress !== deploymentEvent[0]) {
        throw new Error(`Deployment addresses ${contractAddress} and ${deploymentEvent[0]} do not match!`)
      }

      networkMonitor.structuredLog(network, `updateDeployedContract`, tags)

      // @ts-expect-error 'this' is of type any
      await updateDeployedContract.call(this, transaction, network, contractAddress, deploymentConfig, tags)
    }
  } else {
    networkMonitor.structuredLog(network, `Transaction failed, ignoring it`, tags)
  }
}

export default handleContractDeployedEvent
