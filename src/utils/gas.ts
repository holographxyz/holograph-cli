import {BigNumber} from '@ethersproject/bignumber'
import {Block, BlockWithTransactions} from '@ethersproject/abstract-provider'
import {WebSocketProvider, JsonRpcProvider} from '@ethersproject/providers'
import {NetworkKeys, networks} from '@holographxyz/networks'

export type GasPricing = {
  isEip1559: boolean
  // For non EIP-1559 transactions
  gasPrice: BigNumber | null
  // For EIP-1559 transactions
  nextBlockFee: BigNumber | null
  // For EIP-1559 transactions
  nextPriorityFee: BigNumber | null
  // For EIP-1559 transactions
  maxFeePerGas: BigNumber | null

  lowestBlockFee: BigNumber | null
  averageBlockFee: BigNumber | null
  highestBlockFee: BigNumber | null

  lowestPriorityFee: BigNumber | null
  averagePriorityFee: BigNumber | null
  highestPriorityFee: BigNumber | null
}

export type BlockFeeConfig = {
  gasLimit: BigNumber
  gasTarget: BigNumber
  elasticityMultiplier: BigNumber
  maxChangeDenominator: BigNumber
  maxBaseFeeIncrease: BigNumber
  maxBaseFeeDecrease: BigNumber
  blockTime: BigNumber
}
const defaultBlockFeeConfig: BlockFeeConfig = {
  gasLimit: BigNumber.from('30000000'),
  gasTarget: BigNumber.from('15000000'),
  elasticityMultiplier: BigNumber.from('2'),
  maxChangeDenominator: BigNumber.from('8'),
  maxBaseFeeIncrease: BigNumber.from('1250'), // bps
  maxBaseFeeDecrease: BigNumber.from('1250'), // bps
  blockTime: BigNumber.from('12000'), // milliseconds
}

const blockFeeConfigOverrides: {[k: NetworkKeys]: BlockFeeConfig} = {
  ['polygon' as NetworkKeys]: Object.assign(defaultBlockFeeConfig, {
    maxChangeDenominator: BigNumber.from('16'),
  }) as BlockFeeConfig,
  ['polygonTestnet' as NetworkKeys]: Object.assign(defaultBlockFeeConfig, {
    maxChangeDenominator: BigNumber.from('16'),
  }) as BlockFeeConfig,
  ['arbitrumOne' as NetworkKeys]: Object.assign(defaultBlockFeeConfig, {
    gasTarget: BigNumber.from('5000000'),
    elasticityMultiplier: BigNumber.from('6'),
    maxChangeDenominator: BigNumber.from('50'),
    maxBaseFeeIncrease: BigNumber.from('1000'), // bps
    maxBaseFeeDecrease: BigNumber.from('200'), // bps
    blockTime: BigNumber.from('2000'), // milliseconds
  }) as BlockFeeConfig,
  ['arbitrumTestnetGoerli' as NetworkKeys]: Object.assign(defaultBlockFeeConfig, {
    gasTarget: BigNumber.from('5000000'),
    elasticityMultiplier: BigNumber.from('6'),
    maxChangeDenominator: BigNumber.from('50'),
    maxBaseFeeIncrease: BigNumber.from('1000'), // bps
    maxBaseFeeDecrease: BigNumber.from('200'), // bps
    blockTime: BigNumber.from('2000'), // milliseconds
  }) as BlockFeeConfig,
}

const zero: BigNumber = BigNumber.from('0')
const one: BigNumber = BigNumber.from('1')

// Implemented from https://eips.ethereum.org/EIPS/eip-1559
export function calculateNextBlockFee(network: string, parent: Block | BlockWithTransactions): BigNumber {
  if (parent.baseFeePerGas === undefined) {
    return zero
  }

  let blockFeeConfig: BlockFeeConfig = defaultBlockFeeConfig
  if ((network as NetworkKeys) in blockFeeConfigOverrides) {
    blockFeeConfig = blockFeeConfigOverrides[network as NetworkKeys]
  }

  const baseFeePerGas: BigNumber = parent.baseFeePerGas!
  let nextBlockFee: BigNumber = baseFeePerGas
  const parentGasTarget: BigNumber = blockFeeConfig.gasLimit.div(blockFeeConfig.elasticityMultiplier)
  if (parent.gasUsed.eq(parentGasTarget)) {
    return baseFeePerGas
  }

  let gasUsedDelta: BigNumber
  let baseFeeDelta: BigNumber
  const maxFeeIncrease: BigNumber = baseFeePerGas.mul(BigNumber.from('10000')).div(blockFeeConfig.maxBaseFeeIncrease)
  const maxFeeDecrease: BigNumber = baseFeePerGas.mul(BigNumber.from('10000')).div(blockFeeConfig.maxBaseFeeDecrease)

  // If the parent block used more gas than its target, the baseFee should increase.
  if (parent.gasUsed.gt(parentGasTarget)) {
    gasUsedDelta = parent.gasUsed.sub(parentGasTarget)
    baseFeeDelta = baseFeePerGas.mul(gasUsedDelta).div(parentGasTarget).div(blockFeeConfig.maxChangeDenominator)
    if (one.gt(baseFeeDelta)) {
      baseFeeDelta = one
    }

    nextBlockFee = baseFeePerGas.add(baseFeeDelta)
    if (nextBlockFee.gt(baseFeePerGas.add(maxFeeIncrease))) {
      return baseFeePerGas.add(maxFeeIncrease)
    }

    return nextBlockFee
  }

  // Otherwise if the parent block used less gas than its target, the baseFee should decrease.
  gasUsedDelta = parentGasTarget.sub(parent.gasUsed)
  baseFeeDelta = baseFeePerGas.mul(gasUsedDelta).div(parentGasTarget).div(blockFeeConfig.maxChangeDenominator)

  nextBlockFee = baseFeePerGas.sub(baseFeeDelta)
  if (nextBlockFee.lt(baseFeePerGas.sub(maxFeeDecrease))) {
    return baseFeePerGas.sub(maxFeeDecrease)
  }

  return nextBlockFee
}

// This function is here to accomodate instances where a network has a minimum BaseBlockFee
export function adjustBaseBlockFee(network: string, baseBlockFee: BigNumber): BigNumber {
  // Avalanche has a minimum BaseBlockFee of 25 GWEI
  // https://docs.avax.network/quickstart/transaction-fees#base-fee
  if (
    (network === networks['avalanche' as NetworkKeys].key ||
      network === networks['avalancheTestnet' as NetworkKeys].key) &&
    baseBlockFee.lt(BigNumber.from('25000000000'))
  ) {
    return BigNumber.from('25000000000')
  }

  return baseBlockFee
}

export async function initializeGasPricing(
  network: string,
  provider: JsonRpcProvider | WebSocketProvider,
): Promise<GasPricing> {
  const block: Block = await provider.getBlock('latest')
  const gasPrices: GasPricing = updateGasPricing(network, block, {
    isEip1559: false,
    gasPrice: null,
    nextBlockFee: null,
    nextPriorityFee: null,
    maxFeePerGas: null,
    lowestBlockFee: null,
    averageBlockFee: null,
    highestBlockFee: null,
    lowestPriorityFee: null,
    averagePriorityFee: null,
    highestPriorityFee: null,
  } as GasPricing)
  if (!gasPrices.isEip1559) {
    // need to replace this with internal calculations
    gasPrices.gasPrice = await provider.getGasPrice()
  }

  return gasPrices
}

export function updateGasPricing(
  network: string,
  block: Block | BlockWithTransactions,
  gasPricing: GasPricing,
): GasPricing {
  if (block.baseFeePerGas) {
    gasPricing.isEip1559 = true
    gasPricing.nextBlockFee = adjustBaseBlockFee(network, calculateNextBlockFee(network, block))
    gasPricing.maxFeePerGas = gasPricing.nextBlockFee!
    if (gasPricing.nextPriorityFee === null) {
      gasPricing.nextPriorityFee = BigNumber.from('0')
      gasPricing.gasPrice = gasPricing.nextBlockFee
    } else {
      gasPricing.maxFeePerGas = gasPricing.nextBlockFee!.add(gasPricing.nextPriorityFee!)
      gasPricing.gasPrice = gasPricing.maxFeePerGas
    }
  }
  // this is only called if blockchain is not EIP-1559 compatible
  // mostly POW chains
  else {
    // this if statement is only used once when gas pricing is undefined and first block is being passed in
    if (gasPricing.gasPrice === null) {
      gasPricing.gasPrice = BigNumber.from('0')
    }

    gasPricing.gasPrice = adjustBaseBlockFee(network, gasPricing.gasPrice)
  }

  return gasPricing
}
