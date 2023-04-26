import {BigNumber, BigNumberish} from '@ethersproject/bignumber'
import {Contract} from '@ethersproject/contracts'
import {formatUnits} from '@ethersproject/units'

import {NetworkMonitor} from './network-monitor'
import {zeroAddress} from './utils'
import {HealthCheck} from '../base-commands/healthcheck'

export interface OperatorJobDetails {
  pod: number
  blockTimes: number
  operator: string
  startBlock: number
  startTimestamp: BigNumberish
  fallbackOperators: number[]
}

export interface OperatorJob {
  network: string
  hash: string
  payload: string
  targetTime: number
  gasLimit: BigNumberish
  gasPrice: BigNumberish
  jobDetails: OperatorJobDetails
  tags?: (string | number)[]
}

export interface OperatorStatus {
  address: string
  active: {[key: string]: boolean}
  currentPod: {[key: string]: number}
  podIndex: {[key: string]: number}
  podSize: {[key: string]: number}
}

export abstract class OperatorJobAwareCommand extends HealthCheck {
  networkMonitor!: NetworkMonitor
  operatorStatus: OperatorStatus = {
    address: '',
    active: {},
    currentPod: {},
    podIndex: {},
    podSize: {},
  }

  operatorJobs: {[key: string]: OperatorJob} = {}

  getTargetTime(network: string, jobDetails: OperatorJobDetails): number {
    let targetTime: number = new Date(BigNumber.from(jobDetails.startTimestamp).toNumber() * 1000).getTime()
    if (jobDetails.operator !== zeroAddress && jobDetails.operator !== this.operatorStatus.address) {
      // operator is not selected
      // add +60 seconds to target time
      targetTime += 60 * 1000

      // ignore where operator is not in same pod
      if (jobDetails.pod === this.operatorStatus.currentPod[network]) {
        for (let i = 0; i < 5; i++) {
          if (
            jobDetails.fallbackOperators[i] >= this.operatorStatus.podSize[network] ||
            jobDetails.fallbackOperators[i] === 0
          ) {
            // anyone from that pod can operate
            break
          } else if (jobDetails.fallbackOperators[i] === this.operatorStatus.podIndex[network]) {
            // operator has been selected as the fallback
            break
          }

          // add +60 seconds to target time
          targetTime += 60 * 1000
        }
      } else {
        // add time delay for 5 fallback operators to have a chance first
        targetTime += 60 * 1000 * 5
      }
    }

    return targetTime
  }

  async decodeOperatorJob(
    network: string,
    operatorJobHash: string,
    operatorJobPayload: string,
    tags: (string | number)[],
  ): Promise<OperatorJob | undefined> {
    const contract: Contract = this.networkMonitor.operatorContract.connect(this.networkMonitor.providers[network])
    const rawJobDetails: any[] = await contract.getJobDetails(operatorJobHash)
    const jobDetails: OperatorJobDetails = {
      pod: rawJobDetails[0] as number,
      blockTimes: rawJobDetails[1] as number,
      operator: (rawJobDetails[2] as string).toLowerCase(),
      startBlock: rawJobDetails[3] as number,
      startTimestamp: BigNumber.from(rawJobDetails[4]),
      fallbackOperators: rawJobDetails[5] as number[],
    } as OperatorJobDetails
    if (jobDetails.startBlock > 0) {
      // for some reason these logs dont have tag attached.

      this.networkMonitor.structuredLog(network, `Decoded valid job ${operatorJobHash}`, tags)
      this.networkMonitor.structuredLog(network, `Selected operator for job is ${jobDetails.operator}`, tags)
      const targetTime: number = this.getTargetTime(network, jobDetails)
      // extract gasLimit and gasPrice from payload
      const gasLimit: BigNumber = BigNumber.from('0x' + operatorJobPayload.slice(-128, -64))
      this.networkMonitor.structuredLog(network, `Job gas limit is ${gasLimit.toNumber()}`, tags)
      const gasPrice: BigNumber = BigNumber.from('0x' + operatorJobPayload.slice(-64))
      this.networkMonitor.structuredLog(network, `Job maximum gas price is ${formatUnits(gasPrice, 'gwei')} GWEI`, tags)
      const remainingTime: number = Math.round((targetTime - Date.now()) / 1000)
      this.networkMonitor.structuredLog(
        network,
        `Job can be operated ${remainingTime <= 0 ? 'immediately' : 'in ' + remainingTime + ' seconds'}`,
        tags,
      )
      this.operatorJobs[operatorJobHash] = {
        network,
        hash: operatorJobHash,
        payload: operatorJobPayload,
        targetTime,
        gasLimit,
        gasPrice,
        jobDetails,
        tags,
      } as OperatorJob
      // process.stdout.write('\n\n' + JSON.stringify(this.operatorJobs[operatorJobHash],undefined,2) + '\n\n')
      return this.operatorJobs[operatorJobHash]
    }

    this.networkMonitor.structuredLogError(
      network,
      `Could not decode job ${operatorJobHash} (invalid or already completed)`,
      tags,
    )

    return undefined
  }

  updateJobTimes(): void {
    for (const hash of Object.keys(this.operatorJobs)) {
      const job: OperatorJob = this.operatorJobs[hash]
      this.operatorJobs[hash].targetTime = this.getTargetTime(job.network, job.jobDetails)
    }
  }

  /*
    @dev defining some of the current values like: if operator is bonded on the network, which pod they are in,
         which index position inside of the pod doe they hold (used for fallback operator calculations),
         the current pod size (used for fallback operator calculations).
  */
  async updateOperatorStatus(network: string): Promise<void> {
    const contract: Contract = this.networkMonitor.operatorContract.connect(this.networkMonitor.providers[network])
    this.operatorStatus.active[network] = !BigNumber.from(
      await contract.getBondedAmount(this.operatorStatus.address),
    ).isZero()
    this.operatorStatus.currentPod[network] = BigNumber.from(
      await contract.getBondedPod(this.operatorStatus.address),
    ).toNumber()
    this.operatorStatus.podIndex[network] = BigNumber.from(
      await contract.getBondedPodIndex(this.operatorStatus.address),
    ).toNumber()
    if (this.operatorStatus.currentPod[network] > 0) {
      this.operatorStatus.podSize[network] = BigNumber.from(
        await contract.getPodOperatorsLength(this.operatorStatus.currentPod[network]),
      ).toNumber()
    }
  }

  async checkJobStatus(operatorJobHash: string, tags?: (string | number)[]): Promise<void> {
    if (operatorJobHash !== undefined && operatorJobHash !== '' && operatorJobHash in this.operatorJobs) {
      const job: OperatorJob = this.operatorJobs[operatorJobHash]
      if ((await this.decodeOperatorJob(job.network, job.hash, job.payload, tags ?? ([] as string[]))) === undefined) {
        this.networkMonitor.structuredLogError(
          job.network,
          `Job ${job.hash} is no longer active/valid, removing it from list`,
          tags ?? ([] as string[]),
        )
        delete this.operatorJobs[job.hash]
      }
    }
  }
}
