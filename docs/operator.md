# `holograph operator`

Listen for jobs and execute jobs.

- [`holograph operator`](#holograph-operator)
- [`holograph operator:bond`](#holograph-operatorbond)
- [`holograph operator:recover`](#holograph-operatorrecover)
- [`holograph operator:unbond`](#holograph-operatorunbond)

## `holograph operator`

Listen for jobs and execute jobs.

```
USAGE
  $ holograph operator [-m listen|manual|auto] [--unsafePassword <value>] [-h <value>] [--greedy] [--sync]
    [--updateBlockHeight api|file|disable] [--networks seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTe
    stnetGoerli|zoraTestnetSepolia|baseTestnetSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepol
    ia|baseTestnetGoerli|zoraTestnetGoerli|mantleTestnet|optimismTestnetGoerli|arbitrumTestnetGoerli|ethereumTestnetGoer
    li|polygonTestnet|avalancheTestnet|binanceSmartChainTestnet] [-r <value>] [--process-block-range] [--healthCheckPort
    <value> --healthCheck] [--env mainnet|testnet|develop|experimental]

FLAGS
  -h, --host=<value>
      The host to send data to

  -m, --mode=<option>
      The mode in which to run the operator
      <options: listen|manual|auto>

  -r, --replay=<value>
      [default: 0] Replay block processing. Run between the closed range defined. E.g. 30909:30999

  --env=<option>
      [default: testnet] Holograph environment to use
      <options: mainnet|testnet|develop|experimental>

  --greedy
      Enable greedy mode which will retry failed jobs with a higher gas limit in order to execute

  --healthCheck
      Launch server on http://localhost:6000 to make sure command is still running

  --healthCheckPort=<value>
      This flag allows you to choose what port the health check sever is running on.

  --networks=<option>...
      Space separated list of networks to use
      <options: seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnetSepolia|baseTestne
      tSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|baseTestnetGoerli|zoraTestnetGoerli|ma
      ntleTestnet|optimismTestnetGoerli|arbitrumTestnetGoerli|ethereumTestnetGoerli|polygonTestnet|avalancheTestnet|binanc
      eSmartChainTestnet>

  --process-block-range
      Process block ranges instead of single blocks.

  --sync
      Start from last saved block position instead of latest block position

  --unsafePassword=<value>
      Enter the plain text password for the wallet in the holograph cli config

  --updateBlockHeight=<option>
      [default: file] Define how to save the last block that was processed.
      <options: api|file|disable>

DESCRIPTION
  Listen for jobs and execute jobs.

EXAMPLES
  $ holograph operator --networks ethereumTestnetSepolia polygonTestnet avalancheTestnet --mode=auto --sync --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/operator/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/operator/index.ts)_

## `holograph operator:bond`

Bond in to a pod.

```
USAGE
  $ holograph operator:bond [--network
    seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnetSepolia|baseTestnetSepolia|a
    rbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|baseTestnetGoerli|zoraTestnetGoerli|mantleTestne
    t|optimismTestnetGoerli|arbitrumTestnetGoerli|ethereumTestnetGoerli|polygonTestnet|avalancheTestnet|binanceSmartChai
    nTestnet] [--pod <value>] [--amount <value>] [--env mainnet|testnet|develop|experimental]

FLAGS
  --amount=<value>    Amount of tokens to deposit
  --env=<option>      [default: testnet] Holograph environment to use
                      <options: mainnet|testnet|develop|experimental>
  --network=<option>  Name of network to use
                      <options: seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnet
                      Sepolia|baseTestnetSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|ba
                      seTestnetGoerli|zoraTestnetGoerli|mantleTestnet|optimismTestnetGoerli|arbitrumTestnetGoerli|ethere
                      umTestnetGoerli|polygonTestnet|avalancheTestnet|binanceSmartChainTestnet>
  --pod=<value>       Pod number to join

DESCRIPTION
  Bond in to a pod.

EXAMPLES
  $ holograph operator:bond --network <string> --pod <number> --amount <number> --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/operator/bond.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/operator/bond.ts)_

## `holograph operator:recover`

Attempt to re-run/recover a specific job.

```
USAGE
  $ holograph operator:recover [--network
    seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnetSepolia|baseTestnetSepolia|a
    rbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|baseTestnetGoerli|zoraTestnetGoerli|mantleTestne
    t|optimismTestnetGoerli|arbitrumTestnetGoerli|ethereumTestnetGoerli|polygonTestnet|avalancheTestnet|binanceSmartChai
    nTestnet --tx <value>] [-f <value> | ] [-m listen|manual|auto] [--greedy] [--update-db -h <value>]
    [--healthCheckPort <value> --healthCheck] [--config-file <value>] [--unsafe-password <value>] [--env
    mainnet|testnet|develop|experimental]

FLAGS
  -f, --file=<value>
      JSON file path of incomplete jobs (ie "./incompleteJobs.json") in format [{ source_tx, source_chain_id}]

  -h, --host=<value>
      The host to send data to

  -m, --mode=<option>
      The mode in which to run the operator
      <options: listen|manual|auto>

  --config-file=<value>
      Path to the config file to load

  --env=<option>
      [default: testnet] Holograph environment to use
      <options: mainnet|testnet|develop|experimental>

  --greedy
      Enable greedy mode which will retry failed jobs with a higher gas limit in order to execute

  --healthCheck
      Launch server on http://localhost:6000 to make sure command is still running

  --healthCheckPort=<value>
      This flag allows you to choose what port the health check sever is running on.

  --network=<option>
      The network on which the transaction was executed
      <options: seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnetSepolia|baseTestne
      tSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|baseTestnetGoerli|zoraTestnetGoerli|ma
      ntleTestnet|optimismTestnetGoerli|arbitrumTestnetGoerli|ethereumTestnetGoerli|polygonTestnet|avalancheTestnet|binanc
      eSmartChainTestnet>

  --tx=<value>
      The hash of transaction that we want to attempt to execute

  --unsafe-password=<value>
      Enter the plain text password for the wallet in the holograph cli config

  --update-db
      Update the DB with the status of the bridge that was being processed

DESCRIPTION
  Attempt to re-run/recover a specific job.

EXAMPLES
  $ holograph operator:recover --network="ethereumTestnetGoerli" --tx="0x..." --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/operator/recover.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/operator/recover.ts)_

## `holograph operator:unbond`

Un-bond an operator from a pod

```
USAGE
  $ holograph operator:unbond [--env mainnet|testnet|develop|experimental]

FLAGS
  --env=<option>  [default: testnet] Holograph environment to use
                  <options: mainnet|testnet|develop|experimental>

DESCRIPTION
  Un-bond an operator from a pod

EXAMPLES
  $ holograph operator:unbond --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/operator/unbond.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/operator/unbond.ts)_
