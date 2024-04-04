`holograph status`
==================

Get the status of a contract or NFT.

* [`holograph status`](#holograph-status)
* [`holograph status:contract`](#holograph-statuscontract)
* [`holograph status:nft`](#holograph-statusnft)

## `holograph status`

Get the status of a contract or NFT.

```
USAGE
  $ holograph status [--env mainnet|testnet|develop|experimental]

FLAGS
  --env=<option>  [default: testnet] Holograph environment to use
                  <options: mainnet|testnet|develop|experimental>

DESCRIPTION
  Get the status of a contract or NFT.

EXAMPLES
  Learn how to get the status of a contract

    $ holograph status:contract --help --env mainnet|testnet|develop|experimental

  Learn how to get the status of an NFT

    $ holograph status:nft --help --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/status/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/status/index.ts)_

## `holograph status:contract`

Check the status of a contract across all networks defined in the config.

```
USAGE
  $ holograph status:contract [--address <value>] [--output csv|json|yaml|] [--env
    mainnet|testnet|develop|experimental]

FLAGS
  --address=<value>  The address of contract to check status of
  --env=<option>     [default: testnet] Holograph environment to use
                     <options: mainnet|testnet|develop|experimental>
  --output=<option>  [default: yaml] Define table output type
                     <options: csv|json|yaml|>

DESCRIPTION
  Check the status of a contract across all networks defined in the config.

EXAMPLES
  $ holograph status:contract --address="0x5059bf8E4De43ccc0C27ebEc9940e2310E071A78" --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/status/contract.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/status/contract.ts)_

## `holograph status:nft`

Check the status of an NFT across all networks defined in the config.

```
USAGE
  $ holograph status:nft [--address <value>] [--id <value>] [--output csv|json|yaml|] [--env
    mainnet|testnet|develop|experimental]

FLAGS
  --address=<value>  The address of contract to check status of
  --env=<option>     [default: testnet] Holograph environment to use
                     <options: mainnet|testnet|develop|experimental>
  --id=<value>       Token ID to check
  --output=<option>  [default: yaml] Define table output type
                     <options: csv|json|yaml|>

DESCRIPTION
  Check the status of an NFT across all networks defined in the config.

EXAMPLES
  $ holograph status:nft --address="0x5059bf8E4De43ccc0C27ebEc9940e2310E071A78" --id=1 --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/status/nft.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/status/nft.ts)_
