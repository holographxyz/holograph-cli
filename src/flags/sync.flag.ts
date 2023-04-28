import * as inquirer from 'inquirer'
import {Flags} from '@oclif/core'

export const syncFlag = {
  sync: Flags.boolean({
    description: 'Start from last saved block position instead of latest block position',
    default: false,
  }),
}

export const shouldSync = async (syncFlagValue: boolean, latestBlockHeight: {[key: string]: number}) => {
  if (syncFlagValue) {
    return true
  }

  let canSync = false
  const lastBlockKeys: string[] = Object.keys(latestBlockHeight)

  for (let i = 0, l: number = lastBlockKeys.length; i < l; i++) {
    if (latestBlockHeight[lastBlockKeys[i]] > 0) {
      canSync = true
      break
    }
  }

  if (canSync && !syncFlagValue) {
    const syncPrompt: any = await inquirer.prompt([
      {
        name: 'shouldSync',
        message: 'Operator has previous (missed) blocks that can be synced. Would you like to sync?',
        type: 'confirm',
        default: true,
      },
    ])
    return syncPrompt.shouldSync as boolean
  }

  return false
}
