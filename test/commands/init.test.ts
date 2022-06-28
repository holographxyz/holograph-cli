import {expect, test} from '@oclif/test'

describe.skip('init command', () => {
  test
  .stdout()
  .command(['init'])
  .it('runs init', ctx => {
    expect(ctx.stdout).to.contain('select the default network to bridge FROM (origin network)')
  })
})
