import {BigNumber} from '@ethersproject/bignumber'
import {Block, BlockWithTransactions, FeeData} from '@ethersproject/abstract-provider'
import {WebSocketProvider, JsonRpcProvider} from '@ethersproject/providers'

export type GasPricing = {
  isEip1559: boolean
  // For non EIP-1559 transactions
  gasPrice: BigNumber | null
  // For EIP-1559 transactions
  nextBlockFee: BigNumber | null
  // these are internal calculations
  maxFeePerGas: BigNumber | null
  // For EIP-1559 transactions
  // these are internal calculations
  maxPriorityFeePerGas: BigNumber | null
  // For EIP-1559 transactions
  // these are ethers.js calculations
  feeData: FeeData | null
}

// Implemented from https://eips.ethereum.org/EIPS/eip-1559
export function calculateNextBlockFee(parent: Block | BlockWithTransactions): BigNumber {
  const zero: BigNumber = BigNumber.from('0')
  if (parent.baseFeePerGas === undefined) {
    return zero
  }

  const one: BigNumber = BigNumber.from('1')
  const elasticityMultiplier: BigNumber = BigNumber.from('2')
  const baseFeeMaxChangeDenominator: BigNumber = BigNumber.from('8')
  const baseFeePerGas: BigNumber = parent.baseFeePerGas!
  const parentGasTarget: BigNumber = parent.gasLimit.div(elasticityMultiplier)
  if (parent.gasUsed.eq(parentGasTarget)) {
    return baseFeePerGas
  }

  let gasUsedDelta: BigNumber
  let baseFeeDelta: BigNumber
  if (parent.gasUsed.gt(parentGasTarget)) {
    // If the parent block used more gas than its target, the baseFee should increase.
    gasUsedDelta = parent.gasUsed.sub(parentGasTarget)
    baseFeeDelta = baseFeePerGas.mul(gasUsedDelta).div(parentGasTarget).div(baseFeeMaxChangeDenominator)
    if (one.gt(baseFeeDelta)) {
      baseFeeDelta = one
    }

    return baseFeePerGas.add(baseFeeDelta)
  }

  // Otherwise if the parent block used less gas than its target, the baseFee should decrease.
  gasUsedDelta = parentGasTarget.sub(parent.gasUsed)
  baseFeeDelta = baseFeePerGas.mul(gasUsedDelta).div(parentGasTarget).div(baseFeeMaxChangeDenominator)
  return baseFeePerGas.sub(baseFeeDelta)
}

export function adjustBaseBlockFee(network: string, baseBlockFee: BigNumber): BigNumber {
  if ((network === 'avalancheTestnet' || network === 'avalanche') && baseBlockFee.lt(BigNumber.from('25000000000'))) {
    return BigNumber.from('25000000000')
  }

  return baseBlockFee
}

export async function initializeGasPricing(
  network: string,
  provider: JsonRpcProvider | WebSocketProvider,
): Promise<GasPricing> {
  const gasPrices: GasPricing = {
    isEip1559: false,
    nextBlockFee: null,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    feeData: null,
    gasPrice: null,
  } as GasPricing
  const block: Block = await provider.getBlock('latest')
  const isEip1559: boolean = 'baseFeePerGas' in block
  gasPrices.isEip1559 = isEip1559
  if (isEip1559) {
    const feeData: FeeData = await provider.getFeeData()
    gasPrices.nextBlockFee = adjustBaseBlockFee(network, calculateNextBlockFee(block))
    gasPrices.maxFeePerGas = feeData.maxFeePerGas
    gasPrices.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
    gasPrices.feeData = feeData
    gasPrices.gasPrice = feeData.gasPrice
  } else {
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
    gasPricing.nextBlockFee = adjustBaseBlockFee(network, calculateNextBlockFee(block))
    gasPricing.maxPriorityFeePerGas = BigNumber.from('1500000000')
    gasPricing.maxFeePerGas = gasPricing.nextBlockFee!.add(BigNumber.from('1500000000'))
    gasPricing.gasPrice = gasPricing.maxFeePerGas
  }

  return gasPricing
}
