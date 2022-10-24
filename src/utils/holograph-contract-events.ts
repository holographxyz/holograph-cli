export const HolographERC20Event = [
  {name: 'bridgeIn', value: 1},
  {name: 'bridgeOut', value: 2},
  {name: 'afterApprove', value: 3},
  {name: 'beforeApprove', value: 4},
  {name: 'afterOnERC20Received', value: 5},
  {name: 'beforeOnERC20Received', value: 6},
  {name: 'afterBurn', value: 7},
  {name: 'beforeBurn', value: 8},
  {name: 'afterMint', value: 9},
  {name: 'beforeMint', value: 10},
  {name: 'afterSafeTransfer', value: 11},
  {name: 'beforeSafeTransfer', value: 12},
  {name: 'afterTransfer', value: 13},
  {name: 'beforeTransfer', value: 14},
]

export const HolographERC721Event = [
  {name: 'bridgeIn', value: 1},
  {name: 'bridgeOut', value: 2},
  {name: 'afterApprove', value: 3},
  {name: 'beforeApprove', value: 4},
  {name: 'afterApprovalAll', value: 5},
  {name: 'beforeApprovalAll', value: 6},
  {name: 'afterBurn', value: 7},
  {name: 'beforeBurn', value: 8},
  {name: 'afterMint', value: 9},
  {name: 'beforeMint', value: 10},
  {name: 'afterSafeTransfer', value: 11},
  {name: 'beforeSafeTransfer', value: 12},
  {name: 'afterTransfer', value: 13},
  {name: 'beforeTransfer', value: 14},
  {name: 'beforeOnERC721Received', value: 15},
  {name: 'afterOnERC721Received', value: 16},
]

export function allEventsEnabled(): string {
  return '0x' + 'ff'.repeat(32)
}

export function configureEvents(config: number[]): string {
  let binary: string = '0'.repeat(256)
  for (let i = 0, l = config.length; i < l; i++) {
    const num: number = config[i]
    binary = binary.replace(new RegExp('(.{' + num + '}).{1}(.*)', 'gi'), '$11$2')
  }

  binary = [...binary].reverse().join('')
  const byteArray: string[] = binary.match(/.{8}/g) || []
  let hex = '0x'
  for (let i = 0, l = byteArray.length; i < l; i++) {
    hex += Number.parseInt(byteArray[i], 2).toString(16).padStart(2, '0')
  }

  return hex
}
