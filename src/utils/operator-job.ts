import {BigNumber, BigNumberish} from '@ethersproject/bignumber'
import {Contract} from '@ethersproject/contracts'

import {NetworkMonitor} from './network-monitor'
import {zeroAddress} from './web3'
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
  failedOperatorJobs: {[key: string]: OperatorJob} = {}

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
    try {
      const contract: Contract = this.networkMonitor.operatorContract.connect(this.networkMonitor.providers[network])

      const rawJobDetails = await this.fetchJobDetails(contract, operatorJobHash)
      const jobDetails = this.validateAndParseJobDetails(rawJobDetails, operatorJobHash)

      this.networkMonitor.structuredLog(network, `Decoded valid job ${operatorJobHash}`, tags)

      const targetTime: number = this.getTargetTime(network, jobDetails)

      const {gasLimit, gasPrice} = this.extractGasDetailsFromPayload(operatorJobPayload)

      const operatorJob: OperatorJob = {
        network,
        hash: operatorJobHash,
        payload: operatorJobPayload,
        targetTime,
        gasLimit,
        gasPrice,
        jobDetails,
        tags,
      }

      this.operatorJobs[operatorJobHash] = operatorJob

      this.networkMonitor.structuredLog(
        network,
        `Added job. Total jobs count: ${Object.keys(this.operatorJobs).length}`,
        tags,
      )

      return operatorJob
    } catch (error: any) {
      this.networkMonitor.structuredLogError(network, `Error decoding job ${operatorJobHash}: ${error.message}`, tags)
      return undefined
    }
  }

  private async fetchJobDetails(contract: Contract, operatorJobHash: string): Promise<any[]> {
    const rawJobDetails: any[] = await contract.getJobDetails(operatorJobHash)
    if (!rawJobDetails || rawJobDetails.length < 6) {
      throw new Error(`Invalid job details for job ${operatorJobHash}`)
    }

    return rawJobDetails
  }

  private validateAndParseJobDetails(rawJobDetails: any[], operatorJobHash: string): OperatorJobDetails {
    if (!rawJobDetails) {
      throw new Error(`No job details found for job ${operatorJobHash}`)
    }

    if (rawJobDetails.length < 6) {
      throw new Error(`Incomplete job details for job ${operatorJobHash}`)
    }

    const validators = {
      pod: (value: any) => typeof value === 'number',
      blockTimes: (value: any) => typeof value === 'number',
      operator: (value: any) => typeof value === 'string',
      startBlock: (value: any) => typeof value === 'number' && value > 0,
      startTimestamp: (value: any) => typeof value === 'string' || typeof value === 'number',
      fallbackOperators: (value: any) => Array.isArray(value) && value.every((v: any) => typeof v === 'number'),
    }

    // Create a mapping from key names to their expected indices in the rawJobDetails array
    const keyToIndexMapping: {[key: string]: number} = {
      pod: 0,
      blockTimes: 1,
      operator: 2,
      startBlock: 3,
      startTimestamp: 4,
      fallbackOperators: 5,
    }

    const jobDetails: Partial<OperatorJobDetails> = {}

    for (const [key, validator] of Object.entries(validators)) {
      const index = keyToIndexMapping[key]

      if (!validator(rawJobDetails[index])) {
        throw new Error(`Invalid ${key} value for job ${operatorJobHash}`)
      }

      jobDetails[key as keyof OperatorJobDetails] = rawJobDetails[index]
    }

    return {
      pod: jobDetails.pod as number,
      blockTimes: jobDetails.blockTimes as number,
      operator: (jobDetails.operator as string).toLowerCase(),
      startBlock: jobDetails.startBlock as number,
      startTimestamp: BigNumber.from(jobDetails.startTimestamp as string),
      fallbackOperators: jobDetails.fallbackOperators as number[],
    }
  }

  private extractGasDetailsFromPayload(operatorJobPayload: string): {gasLimit: BigNumber; gasPrice: BigNumber} {
    const gasLimit: BigNumber = BigNumber.from('0x' + operatorJobPayload.slice(-128, -64))
    const gasPrice: BigNumber = BigNumber.from('0x' + operatorJobPayload.slice(-64))

    return {gasLimit, gasPrice}
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
  async updateOperatorStatus(network: string): Promise<boolean> {
    const contract: Contract = this.networkMonitor.operatorContract.connect(this.networkMonitor.providers[network])

    // A flag indicating the success of all contract calls
    let allCallsSuccessful = true

    const contractCall = async <T>(method: () => Promise<T>, errorMessage: string): Promise<T | null> => {
      try {
        return await method()
      } catch (error: any) {
        this.networkMonitor.structuredLogError(network, errorMessage + ': ' + error)
        allCallsSuccessful = false // Mark the flag as false on any error
        return null
      }
    }

    const bondedAmount = await contractCall(
      () => contract.getBondedAmount(this.operatorStatus.address),
      'Error getting Bonded Amount',
    )

    if (bondedAmount) {
      this.operatorStatus.active[network] = !BigNumber.from(bondedAmount).isZero()
    }

    const bondedPod = await contractCall(
      () => contract.getBondedPod(this.operatorStatus.address),
      'Error getting Bonded Pod',
    )

    if (bondedPod) {
      this.operatorStatus.currentPod[network] = BigNumber.from(bondedPod).toNumber()
    }

    const bondedPodIndex = await contractCall(
      () => contract.getBondedPodIndex(this.operatorStatus.address),
      'Error getting Bonded Pod Index',
    )

    if (bondedPodIndex) {
      this.operatorStatus.podIndex[network] = BigNumber.from(bondedPodIndex).toNumber()
    }

    if (this.operatorStatus.currentPod[network] > 0) {
      const podOperatorsLength = await contractCall(
        () => contract.getPodOperatorsLength(this.operatorStatus.currentPod[network]),
        'Error getting Pod Operators Length',
      )

      if (podOperatorsLength) {
        this.operatorStatus.podSize[network] = BigNumber.from(podOperatorsLength).toNumber()
      }
    }

    // Return the final status of all contract calls
    return allCallsSuccessful
  }

  async checkJobStatus(operatorJobHash: string, tags: (string | number)[] = []): Promise<void> {
    // First validate input (Network is not known until job is decoded)
    if (!operatorJobHash || !(operatorJobHash in this.operatorJobs)) {
      this.networkMonitor.structuredLogError(undefined, `Invalid job hash provided: ${operatorJobHash}`, tags)
      return
    }

    // Fetch job from list
    this.networkMonitor.structuredLog(undefined, `Total jobs count: ${Object.keys(this.operatorJobs).length}`, tags)
    const job: OperatorJob = this.operatorJobs[operatorJobHash]
    this.networkMonitor.structuredLog(job.network, `Checking status for job ${job.hash}.`, tags)

    // Then try to decode the job
    try {
      const decodedJob = await this.decodeOperatorJob(job.network, job.hash, job.payload, tags)

      // If the job is no longer valid, remove it from the list
      if (decodedJob === undefined) {
        this.networkMonitor.structuredLogError(
          job.network,
          `Job ${job.hash} is no longer active/valid, removing it from list`,
          tags,
        )
        delete this.operatorJobs[job.hash]
      }
    } catch (error: any) {
      this.networkMonitor.structuredLogError(
        job.network,
        `Error while checking job ${job.hash}: ${error.message}`,
        tags,
      )
    }
  }
}
