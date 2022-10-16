import {Environment} from './environment'

const HOLOGRAPH_EXPERIMENTAL_ADDRESS: string = '0x1466ACC19f239fe7d7CA1B5ca36b97CEB488B38B'.toLowerCase()
const HOLOGRAPH_DEVELOP_ADDRESS: string = '0x0Ab35331cc5130DD52e51a9014069f18b8B5EDF9'.toLowerCase()
const HOLOGRAPH_TESTNET_ADDRESS: string = '0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase()
const HOLOGRAPH_MAINNET_ADDRESS: string = '0x0000000000000000000000000000000000000000'.toLowerCase()

export const HOLOGRAPH_ADDRESSES: {[key in Environment]: string} = {
  [Environment.experimental]: HOLOGRAPH_EXPERIMENTAL_ADDRESS,
  [Environment.develop]: HOLOGRAPH_DEVELOP_ADDRESS,
  [Environment.testnet]: HOLOGRAPH_TESTNET_ADDRESS,
  [Environment.mainnet]: HOLOGRAPH_MAINNET_ADDRESS,
}
