import {Flags} from '@oclif/core'

export enum BlockHeightOptions {
  API = 'api',
  FILE = 'file',
  DISABLE = 'disable',
}

export const blockHeightFlag = {
  updateBlockHeight: Flags.string({
    aliases: ['update-block-height'],
    description: 'Define how to save the last block that was processed.',
    options: Object.values(BlockHeightOptions),
    default: BlockHeightOptions.FILE,
    required: false,
  }),
}
