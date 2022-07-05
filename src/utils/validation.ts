const addressValidator = /^0x[\da-f]{40}$/i
// eslint-disable-next-line prefer-regex-literals
const tokenValidator = new RegExp('^(0x[0-9a-f]{64}|\\d+)$', 'i')
export {addressValidator, tokenValidator}
