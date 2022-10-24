import {BigNumber} from 'ethers'

export interface Signature {
  r: string
  s: string
  v: string
}

export const strictECDSA = function (signature: Signature): Signature {
  const validator: BigNumber = BigNumber.from('0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0')
  if (Number.parseInt(signature.v, 16) < 27) {
    signature.v = '0x' + (27).toString(16).padStart(2, '0')
  }

  if (BigNumber.from(signature.s).gt(validator)) {
    // we have an issue
    signature.s = BigNumber.from('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141')
      .sub(BigNumber.from(signature.s))
      .toHexString()
    let v = Number.parseInt(signature.v, 16)
    v = v === 27 ? 28 : 27
    signature.v = '0x' + v.toString(16).padStart(2, '0')
  }

  return signature
}
